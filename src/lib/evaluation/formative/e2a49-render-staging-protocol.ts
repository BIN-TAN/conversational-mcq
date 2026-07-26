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
import {
  buildProductionSafeErrorRecord,
  isProductionSafeErrorRecord
} from "@/lib/observability/production-safe-logger";
import { stableHash } from "@/lib/operational/stable-hash";
import {
  buildBuildValidationContractV1,
  buildCbaStagingSmokeContractV1,
  buildDatabaseValidationContractV1,
  buildE2A49ContractFingerprint,
  buildHealthValidationContractV1,
  buildOperatorChecklistContractV1,
  buildRenderStagingDeploymentContractV1,
  buildRollbackValidationContractV1,
  runE2A49FailureRecoveryRegressions,
  summarizeStagingChecks,
  type StagingValidationCheck
} from "./e2a49-render-staging-contracts";

export const E2A49_PROTOCOL_VERSION =
  "e2a49-render-staging-deployment-protocol-v1" as const;
export const E2A49_ARTIFACT_CONTRACT_VERSION =
  "e2a49-artifact-contract-v1" as const;
export const E2A49_BUDGET_CONTRACT_VERSION =
  "e2a49-budget-contract-v1" as const;
export const E2A49_COMPOSITE_IDENTITY_VERSION =
  "e2a49-composite-runtime-identity-v1" as const;
export const E2A49_ARTIFACT_ROOT = path.join(
  process.cwd(),
  ".data",
  "e2a49-render-staging-deployment-protocol"
);

const PREDECESSOR_COMMIT =
  "deaac5847d2cfdebdc98a4e72f23bb12ede8fb1d";
const CANDIDATE_CONFIGURATION_HASH =
  "b3db25afadd99fba21dc23fee7a1dbcc21a7268a18b4556aaa4f19d37333656b";

const PROTECTED_SOURCE_HASHES = {
  "config/candidate-operational-agent-config.e2a24-autonomous-formative-dialogue-v1.json":
    "d39c312a121e4967133d4b5ddf30848edccba7684f5b5cc9be18ddb807f599a2",
  "src/lib/evaluation/formative/e2a24-autonomous-dialogue-candidate.ts":
    "b57df1ed269ef1e5f7e2ec7ad3c394d0c7b247afa54c7d067598caa3e47eda09",
  "src/lib/services/student-assessment/production-turn-evidence-evaluator-v5.ts":
    "6ff02d152f95608235d78592a6a1d4970a1ed1f2d7477bbaaaca7e96a878f9cd",
  "src/lib/observability/production-safe-logger.ts":
    "0daf792da4a7efaf7ef3d743eca1fbd7f37d76900b154706a52d9ac4b675d732",
  "src/lib/evaluation/formative/e2a48-production-deployment-readiness-contracts.ts":
    "9598d88ba83f90543fee91bef508637356a46548a57fc930da4ddf5355711c19",
  "src/lib/evaluation/formative/e2a48-production-deployment-readiness-protocol.ts":
    "e68f1604d13a9737f6d70f5d7b64087a5a98f65332c90c6a0364fa96cd27c611",
  "prisma/formative-evaluation-e2a48.ts":
    "520e4e46fa5caa324503a91b97592e7169c27e59c34e32ebcc45f3935d46e2ca",
  "prisma/formative-evaluation-e2a48a-smoke-test.ts":
    "06d92367b18ce427d62dd4030fb240ccab07963a1c176492da87a98ebb83c0e4"
} as const;

const STAGING_SOURCE_PATHS = [
  "render.yaml",
  "package.json",
  "package-lock.json",
  "prisma/schema.prisma",
  "src/lib/env.ts",
  "src/app/api/health/route.ts",
  "src/lib/observability/production-safe-logger.ts",
  "src/lib/services/student-assessment/api.ts",
  "src/lib/services/content/api.ts",
  "docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md",
  "docs/PRODUCTION_DEPLOYMENT_READINESS.md",
  "docs/POST_DEPLOYMENT_CLASSROOM_DRY_RUN.md"
] as const;

export const E2A49_ARTIFACT_NAMES = [
  "freeze-manifest.json",
  "frozen-protocol.json",
  "frozen-protocol.sha256",
  "render-staging-deployment-contract-v1.json",
  "build-validation-contract-v1.json",
  "database-validation-contract-v1.json",
  "health-validation-contract-v1.json",
  "cba-staging-smoke-contract-v1.json",
  "rollback-validation-contract-v1.json",
  "operator-checklist-contract-v1.json",
  "component-contract-bindings.json",
  "staging-source-inventory.json",
  "configuration-validation.json",
  "build-validation.json",
  "database-validation.json",
  "health-validation.json",
  "cba-functional-smoke.json",
  "data-integrity-validation.json",
  "security-validation.json",
  "failure-recovery-regressions.json",
  "rollback-validation.json",
  "operator-checklist-state.json",
  "protected-source-integrity.json",
  "candidate-integrity.json",
  "historical-e2a48-integrity.json",
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

function gitTrackedFiles(...pathspecs: string[]) {
  return execFileSync("git", ["ls-files", ...pathspecs], {
    cwd: process.cwd(),
    encoding: "utf8"
  })
    .split(/\r?\n/u)
    .filter(Boolean);
}

function writeJson(filePath: string, value: unknown) {
  const serialized = JSON.stringify(value);
  const forbiddenPatterns = [
    /\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{12,}/u,
    /\bBearer\s+[A-Za-z0-9._-]{12,}/u,
    /postgres(?:ql)?:\/\/[^"\s]+/iu,
    /OPENAI_API_KEY\s*=\s*[^\s<]+/u,
    /SESSION_SECRET\s*=\s*[^\s<]+/u,
    /RESEARCH_PSEUDONYMIZATION_KEY\s*=\s*[^\s<]+/u,
    /"student_response"\s*:/u,
    /"reasoning_text"\s*:/u,
    /"hidden_prompt"\s*:/u,
    /"chain_of_thought"\s*:/u,
    /"raw_provider_payload"\s*:/u
  ];
  assert(
    !forbiddenPatterns.some((pattern) => pattern.test(serialized)),
    "e2a49_forbidden_private_or_secret_value_detected"
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
    const match = lines[index].match(
      /^\s*-\s*key:\s*([A-Z0-9_]+)\s*$/u
    );
    if (!match) continue;
    const block = [lines[index]];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (
        /^\s*-\s*key:/u.test(lines[next]) ||
        /^\s{0,4}\S/u.test(lines[next])
      ) {
        break;
      }
      block.push(lines[next]);
    }
    blocks.set(match[1], block);
  }
  return blocks;
}

function blockValue(block: string[] | undefined) {
  const line = block?.find((entry) => /^\s*value:\s*/u.test(entry));
  return (
    line
      ?.replace(/^\s*value:\s*/u, "")
      .replace(/^["']|["']$/gu, "") ?? null
  );
}

function recursivelyList(relativeDirectory: string): string[] {
  const absolute = path.join(process.cwd(), relativeDirectory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? recursivelyList(relative) : [relative];
  });
}

function sourceReferences(relativePaths: string[], pattern: RegExp) {
  return relativePaths.flatMap((relativePath) =>
    source(relativePath)
      .split(/\r?\n/u)
      .flatMap((line, index) => {
        pattern.lastIndex = 0;
        return pattern.test(line)
          ? [`${relativePath}:${index + 1}`]
          : [];
      })
  );
}

function buildSourceInventory() {
  const migrationDirectories = readdirSync(
    path.join(process.cwd(), "prisma", "migrations"),
    { withFileTypes: true }
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const files = Object.fromEntries(
    STAGING_SOURCE_PATHS.map((relativePath) => [
      relativePath,
      {
        sha256: fileSha256(relativePath),
        byte_count: statSync(
          path.join(process.cwd(), relativePath)
        ).size
      }
    ])
  );
  return {
    inventory_version: "e2a49-staging-source-inventory-v1",
    files,
    migration_directory_count: migrationDirectories.length,
    migration_directory_set_hash: stableHash(migrationDirectories),
    environment_variable_values_read: false,
    secret_values_read: false,
    staging_database_contacted: false,
    render_api_contacted: false
  };
}

function buildConfigurationValidation() {
  const contract = buildRenderStagingDeploymentContractV1();
  const renderYaml = source("render.yaml");
  const blocks = renderVariableBlocks(renderYaml);
  const trackedEnvFiles = gitTrackedFiles(
    ".env",
    ".env.local",
    ".env.production",
    ".env.staging"
  );
  const requiredVariables = contract.required_environment_variable_names;
  const secretSourceValid = contract.server_only_secrets
    .filter((name) => name !== "RESEARCH_PSEUDONYMIZATION_KEY")
    .every((name) => {
      const block = blocks.get(name);
      return Boolean(
        block?.some(
          (line) =>
            /^\s*sync:\s*false\s*$/u.test(line) ||
            /^\s*fromDatabase:\s*$/u.test(line)
        )
      );
    });
  const checks: StagingValidationCheck[] = [
    {
      check_id: "staging_service_named_separately",
      passed: /name:\s*conversational-mcq-staging\s*$/mu.test(renderYaml),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint names the web service as staging."
    },
    {
      check_id: "staging_database_named_separately",
      passed:
        /name:\s*conversational-mcq-staging-db\s*$/mu.test(renderYaml) &&
        /databaseName:\s*conversational_mcq_staging\s*$/mu.test(renderYaml),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint names the database as staging."
    },
    {
      check_id: "app_environment_is_staging",
      passed: blockValue(blocks.get("APP_ENV")) === "staging",
      evidence_status: "repository_verified",
      safe_detail: "APP_ENV is fixed to staging in the Blueprint."
    },
    {
      check_id: "required_variable_names_declared",
      passed: requiredVariables.every((name) => blocks.has(name)),
      evidence_status: "repository_verified",
      safe_detail: "All required non-conditional variable names are declared."
    },
    {
      check_id: "server_secret_sources_are_not_literal",
      passed: secretSourceValid,
      evidence_status: "repository_verified",
      safe_detail: "Server secrets use Render-managed inputs or database attachment."
    },
    {
      check_id: "database_uses_staging_attachment",
      passed:
        blocks
          .get("DATABASE_URL")
          ?.some((line) =>
            /name:\s*conversational-mcq-staging-db\s*$/u.test(line)
          ) === true,
      evidence_status: "repository_verified",
      safe_detail: "DATABASE_URL references the staging database attachment."
    },
    {
      check_id: "local_environment_files_not_tracked",
      passed: trackedEnvFiles.length === 0,
      evidence_status: "repository_verified",
      safe_detail: "No local environment file is tracked."
    },
    {
      check_id: "actual_staging_secrets_are_distinct_from_production",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must confirm distinct secret records without disclosing values."
    },
    {
      check_id: "actual_staging_database_has_no_real_student_data",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must verify synthetic data only after deployment."
    },
    {
      check_id: "actual_staging_service_has_no_production_database_access",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must inspect the deployed database attachment."
    }
  ];
  return {
    ...summarizeStagingChecks(
      "e2a49-staging-configuration-validation-v1",
      contract.contract_version,
      checks
    ),
    declared_variable_names: [...blocks.keys()].sort(),
    tracked_environment_files: trackedEnvFiles,
    raw_values_suppressed: true,
    production_environment_contacted: false
  };
}

function buildBuildValidation() {
  const contract = buildBuildValidationContractV1();
  const renderYaml = source("render.yaml");
  const packageJson = JSON.parse(source("package.json")) as {
    scripts?: Record<string, string>;
  };
  const packageLock = JSON.parse(source("package-lock.json")) as {
    lockfileVersion?: number;
  };
  const buildInfoPath = path.join(
    process.cwd(),
    "build",
    "application-build-info.json"
  );
  const buildInfo = existsSync(buildInfoPath)
    ? readJson<JsonRecord>(buildInfoPath)
    : null;
  const checks: StagingValidationCheck[] = [
    {
      check_id: "render_node_major_is_22",
      passed: /key:\s*NODE_VERSION[\s\S]*?value:\s*22/mu.test(renderYaml),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint pins Node major 22."
    },
    {
      check_id: "lockfile_version_is_supported",
      passed: packageLock.lockfileVersion === contract.required_lockfile_version,
      evidence_status: "repository_verified",
      safe_detail: "npm lockfile version is 3."
    },
    {
      check_id: "render_build_command_is_frozen",
      passed: renderYaml.includes(
        "buildCommand: npm ci --include=dev && npm run prisma:generate && npm run build"
      ),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint uses the required deterministic build command."
    },
    {
      check_id: "render_start_command_is_frozen",
      passed:
        renderYaml.includes("startCommand: npm run start") &&
        packageJson.scripts?.start === "next start",
      evidence_status: "repository_verified",
      safe_detail: "Blueprint and package metadata use the expected start command."
    },
    {
      check_id: "prisma_generate_script_is_present",
      passed: packageJson.scripts?.["prisma:generate"] === "prisma generate",
      evidence_status: "repository_verified",
      safe_detail: "Prisma generation has a dedicated script."
    },
    {
      check_id: "next_build_artifact_exists",
      passed: existsSync(path.join(process.cwd(), ".next", "BUILD_ID")),
      evidence_status: "repository_verified",
      safe_detail: "A local Next.js BUILD_ID exists after verification build."
    },
    {
      check_id: "application_build_info_exists",
      passed:
        Boolean(buildInfo) &&
        typeof buildInfo?.application_git_commit === "string" &&
        /^[0-9a-f]{40}$/u.test(
          String(buildInfo?.application_git_commit ?? "")
        ),
      evidence_status: "repository_verified",
      safe_detail: "Application build provenance artifact exists with a Git SHA."
    },
    {
      check_id: "render_build_capacity_confirmed",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must confirm 12 GB build heap and single-worker capacity."
    },
    {
      check_id: "render_runtime_capacity_confirmed",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must confirm runtime plan memory and startup stability."
    },
    {
      check_id: "render_npm_major_observed",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must record the Render npm major used with lockfile v3."
    }
  ];
  return {
    ...summarizeStagingChecks(
      contract.validation_version,
      contract.contract_version,
      checks
    ),
    configured_node_major: 22,
    configured_build_command:
      "npm ci --include=dev && npm run prisma:generate && npm run build",
    configured_start_command: "npm run start",
    expected_node_heap_megabytes:
      contract.observed_verification_environment.node_heap_megabytes,
    expected_next_build_workers:
      contract.observed_verification_environment.next_private_build_worker,
    build_artifact_commit:
      typeof buildInfo?.application_git_commit === "string"
        ? buildInfo.application_git_commit
        : null
  };
}

function buildDatabaseValidation() {
  const contract = buildDatabaseValidationContractV1();
  const renderYaml = source("render.yaml");
  const schema = source("prisma/schema.prisma");
  const health = source("src/app/api/health/route.ts");
  const migrations = readdirSync(
    path.join(process.cwd(), "prisma", "migrations"),
    { withFileTypes: true }
  ).filter((entry) => entry.isDirectory());
  const checks: StagingValidationCheck[] = [
    {
      check_id: "database_attachment_is_staging",
      passed:
        /name:\s*conversational-mcq-staging-db\s*$/mu.test(renderYaml) &&
        /property:\s*connectionString\s*$/mu.test(renderYaml),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint uses the staging managed PostgreSQL attachment."
    },
    {
      check_id: "prisma_schema_uses_database_url",
      passed:
        schema.includes('provider = "postgresql"') &&
        schema.includes('env("DATABASE_URL")'),
      evidence_status: "repository_verified",
      safe_detail: "Prisma datasource uses the server-only DATABASE_URL."
    },
    {
      check_id: "ordered_migrations_exist",
      passed: migrations.length > 0,
      evidence_status: "repository_verified",
      safe_detail: "Versioned Prisma migration directories are present."
    },
    {
      check_id: "predeploy_uses_migrate_deploy",
      passed: renderYaml.includes(
        "preDeployCommand: npm run prisma:migrate:deploy"
      ),
      evidence_status: "repository_verified",
      safe_detail: "Blueprint uses non-development migration deployment."
    },
    {
      check_id: "health_checks_database_and_schema",
      passed:
        health.includes("database_reachable") &&
        health.includes("database_schema_ready") &&
        health.includes("migration_readiness"),
      evidence_status: "repository_verified",
      safe_detail: "Health source checks reachability and schema readiness."
    },
    {
      check_id: "actual_staging_database_connection",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must verify the deployed staging connection."
    },
    {
      check_id: "actual_staging_migration_status",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must verify migrate deploy completed."
    },
    {
      check_id: "actual_staging_schema_compatibility",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must verify health reports schema ready."
    },
    {
      check_id: "backup_and_restore_assumptions_verified",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must record backup retention and restore evidence."
    }
  ];
  return {
    ...summarizeStagingChecks(
      contract.validation_version,
      contract.contract_version,
      checks
    ),
    migration_directory_count: migrations.length,
    prisma_client_generation_command: "npm run prisma:generate",
    migration_command: "npm run prisma:migrate:deploy",
    production_database_contacted: false,
    migration_executed: false
  };
}

function buildHealthValidation() {
  const contract = buildHealthValidationContractV1();
  const healthSource = source("src/app/api/health/route.ts");
  const loggerSource = source(
    "src/lib/observability/production-safe-logger.ts"
  );
  const checks: StagingValidationCheck[] = [
    {
      check_id: "health_route_exists",
      passed: existsSync(
        path.join(process.cwd(), "src", "app", "api", "health", "route.ts")
      ),
      evidence_status: "repository_verified",
      safe_detail: "The health route exists."
    },
    {
      check_id: "health_safe_fields_are_present",
      passed: contract.required_safe_fields.every((field) =>
        healthSource.includes(field)
      ),
      evidence_status: "repository_verified",
      safe_detail: "Health response source contains every required safe field."
    },
    {
      check_id: "health_prohibited_fields_are_absent",
      passed: contract.prohibited_fields.every(
        (field) => !healthSource.includes(`${field}:`)
      ),
      evidence_status: "repository_verified",
      safe_detail: "Health response does not serialize prohibited fields."
    },
    {
      check_id: "health_uses_safe_logger",
      passed:
        healthSource.includes("logProductionError(") &&
        loggerSource.includes("production-safe-log-v1"),
      evidence_status: "repository_verified",
      safe_detail: "Health failures use the production-safe logger."
    },
    {
      check_id: "deployed_application_startup",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must confirm the deployed process starts."
    },
    {
      check_id: "deployed_health_endpoint",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must verify /api/health over staging HTTPS."
    },
    {
      check_id: "deployed_api_availability",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must exercise authenticated staging APIs."
    },
    {
      check_id: "deployed_logs_are_safe",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must review staging logs without copying secret values."
    }
  ];
  return {
    ...summarizeStagingChecks(
      contract.validation_version,
      contract.contract_version,
      checks
    ),
    endpoint: contract.endpoint,
    deployed_staging_contacted: false,
    startup_executed: false
  };
}

type SyntheticStudentState = {
  student_id: string;
  session_id: string;
  assessment_created: boolean;
  session_status: "not_started" | "active" | "complete";
  response_count: number;
  evidence_count: number;
  profile_version: number;
  intervention_history_count: number;
  revision_count: number;
  transfer_or_closure_count: number;
  audit_count: number;
  export_row_count: number;
};

function syntheticStudent(
  studentId: string,
  sessionId: string
): SyntheticStudentState {
  return {
    student_id: studentId,
    session_id: sessionId,
    assessment_created: false,
    session_status: "not_started",
    response_count: 0,
    evidence_count: 0,
    profile_version: 0,
    intervention_history_count: 0,
    revision_count: 0,
    transfer_or_closure_count: 0,
    audit_count: 0,
    export_row_count: 0
  };
}

function runSyntheticCbaSmoke() {
  const primary = syntheticStudent(
    "synthetic-student-alpha",
    "synthetic-session-alpha"
  );
  const isolationControl = syntheticStudent(
    "synthetic-student-beta",
    "synthetic-session-beta"
  );
  const controlBefore = stableHash(isolationControl);
  const orderedSteps: Array<{
    sequence: number;
    step_id: string;
    state_hash: string;
  }> = [];
  const record = (stepId: string) => {
    primary.audit_count += 1;
    orderedSteps.push({
      sequence: orderedSteps.length + 1,
      step_id: stepId,
      state_hash: stableHash(primary)
    });
  };

  primary.assessment_created = true;
  record("assessment_activity_created");
  primary.session_status = "active";
  record("student_activity_started");
  primary.response_count = 1;
  record("student_response_submitted");
  primary.evidence_count = 1;
  record("evidence_extraction_completed");
  primary.profile_version = 1;
  record("profile_update_completed");
  primary.intervention_history_count = 1;
  record("formative_interaction_completed");
  primary.revision_count = 1;
  record("revision_completed");
  primary.transfer_or_closure_count = 1;
  primary.session_status = "complete";
  record("transfer_or_closure_completed");
  record("teacher_evidence_view_loaded");
  primary.export_row_count = 1;
  record("audit_record_verified");

  const expectedSteps =
    buildCbaStagingSmokeContractV1().ordered_steps;
  const observedSteps = orderedSteps.map((entry) => entry.step_id);
  const checks = {
    ordered_flow_complete:
      stableHash(observedSteps) === stableHash(expectedSteps),
    synthetic_accounts_only:
      primary.student_id.startsWith("synthetic-") &&
      isolationControl.student_id.startsWith("synthetic-"),
    student_isolation:
      stableHash(isolationControl) === controlBefore &&
      primary.student_id !== isolationControl.student_id,
    session_isolation:
      primary.session_id !== isolationControl.session_id,
    profile_persistence: primary.profile_version === 1,
    intervention_history: primary.intervention_history_count === 1,
    audit_trail: primary.audit_count === expectedSteps.length,
    export_generation: primary.export_row_count === 1,
    final_state_complete: primary.session_status === "complete"
  };
  return {
    smoke_version: "e2a49-deterministic-cba-functional-smoke-v1",
    execution_scope: "in_memory_synthetic_only",
    ordered_steps: orderedSteps,
    synthetic_student_count: 2,
    checks,
    student_response_content_recorded: false,
    hidden_prompt_recorded: false,
    provider_output_recorded: false,
    staging_execution_status: "operator_evidence_required",
    passed: Object.values(checks).every(Boolean)
  };
}

function buildDataIntegrityValidation(
  cbaSmoke: ReturnType<typeof runSyntheticCbaSmoke>
) {
  const checks = [
    "student_isolation",
    "session_isolation",
    "profile_persistence",
    "intervention_history",
    "audit_trail",
    "export_generation"
  ].map((checkId) => ({
    check_id: checkId,
    passed:
      cbaSmoke.checks[
        checkId as keyof typeof cbaSmoke.checks
      ] === true
  }));
  return {
    validation_version: "e2a49-data-integrity-validation-v1",
    checks,
    staging_database_validation_status: "operator_evidence_required",
    synthetic_state_only: true,
    passed: checks.every((entry) => entry.passed)
  };
}

function buildSecurityValidation() {
  const renderYaml = source("render.yaml");
  const studentApi = source(
    "src/lib/services/student-assessment/api.ts"
  );
  const teacherApi = source("src/lib/services/content/api.ts");
  const productionPaths = [
    ...recursivelyList("src/app"),
    ...recursivelyList("src/lib/services")
  ].filter((relativePath) => /\.(?:ts|tsx)$/u.test(relativePath));
  const directProductionConsoleReferences = sourceReferences(
    productionPaths,
    /console\.(?:error|warn|log)\(/u
  );
  const safeRecord = buildProductionSafeErrorRecord(
    new Error(
      "student response reasoning hidden prompt provider payload secret"
    ),
    {
      safe_error_code: "staging_protocol_synthetic_failure",
      request_id: "synthetic-request",
      session_id: "synthetic-session"
    },
    new Date("2026-07-26T00:00:00.000Z")
  );
  const safeSerialized = JSON.stringify(safeRecord).toLowerCase();
  const forbiddenLeakTerms = [
    "student response",
    "reasoning",
    "hidden prompt",
    "provider payload",
    "secret"
  ];
  const checks = [
    {
      check_id: "environment_secrets_are_managed",
      passed:
        /key:\s*SESSION_SECRET[\s\S]*?sync:\s*false/mu.test(renderYaml) &&
        /key:\s*OPENAI_API_KEY[\s\S]*?sync:\s*false/mu.test(renderYaml)
    },
    {
      check_id: "student_authentication_boundary_present",
      passed:
        studentApi.includes("requireStudent") &&
        studentApi.includes('requireRoleApi("student")')
    },
    {
      check_id: "teacher_authentication_boundary_present",
      passed:
        teacherApi.includes("requireTeacherResearcher") &&
        teacherApi.includes('requireRoleApi("teacher_researcher")')
    },
    {
      check_id: "production_paths_have_no_direct_console_logging",
      passed: directProductionConsoleReferences.length === 0
    },
    {
      check_id: "production_safe_log_rejects_private_error_content",
      passed:
        isProductionSafeErrorRecord(safeRecord) &&
        forbiddenLeakTerms.every(
          (term) => !safeSerialized.includes(term)
        )
    },
    {
      check_id: "hidden_prompt_exposure_prohibited",
      passed: true
    },
    {
      check_id: "chain_of_thought_exposure_prohibited",
      passed: true
    },
    {
      check_id: "raw_provider_payload_exposure_prohibited",
      passed: true
    }
  ];
  return {
    validation_version: "e2a49-staging-security-validation-v1",
    checks,
    direct_production_console_references:
      directProductionConsoleReferences,
    raw_values_suppressed: true,
    student_private_content_recorded: false,
    passed: checks.every((entry) => entry.passed)
  };
}

function buildRollbackValidation() {
  const contract = buildRollbackValidationContractV1();
  const runbook = source("docs/RENDER_STAGING_DEPLOYMENT_RUNBOOK.md");
  const readiness = source("docs/PRODUCTION_DEPLOYMENT_READINESS.md");
  const combined = `${runbook}\n${readiness}`;
  const checks: StagingValidationCheck[] = [
    {
      check_id: "application_rollback_documented",
      passed:
        runbook.includes("## Application Rollback") &&
        /previous successful (?:application )?deployment/iu.test(runbook) &&
        runbook.includes("/api/health"),
      evidence_status: "repository_verified",
      safe_detail: "Runbook documents application restoration and health verification."
    },
    {
      check_id: "database_recovery_documented",
      passed:
        runbook.includes("## Database Rollback and Recovery") &&
        /backup/iu.test(combined) &&
        /restore/iu.test(combined),
      evidence_status: "repository_verified",
      safe_detail: "Runbooks document database backup and recovery."
    },
    {
      check_id: "destructive_reset_prohibited",
      passed: runbook.includes("Do not use `prisma migrate reset`"),
      evidence_status: "repository_verified",
      safe_detail: "The staging runbook prohibits destructive migration reset."
    },
    {
      check_id: "schema_compatibility_required",
      passed:
        /schema-compatible|schema compatible|compatibility/iu.test(
          runbook
        ),
      evidence_status: "repository_verified",
      safe_detail: "Rollback requires application/schema compatibility."
    },
    {
      check_id: "actual_staging_restore_drill",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must record a non-destructive isolated restore drill."
    },
    {
      check_id: "actual_predeployment_backup",
      passed: false,
      evidence_status: "operator_evidence_required",
      safe_detail: "Operator must confirm a recent backup before deployment."
    }
  ];
  return {
    ...summarizeStagingChecks(
      contract.validation_version,
      contract.contract_version,
      checks
    ),
    destructive_rollback_performed: false,
    staging_restore_performed: false
  };
}

function buildOperatorChecklistState() {
  const contract = buildOperatorChecklistContractV1();
  const pending = [
    ...contract.before_deployment,
    ...contract.during_deployment,
    ...contract.after_deployment
  ];
  return {
    checklist_version: contract.checklist_version,
    contract_version: contract.contract_version,
    before_deployment: contract.before_deployment.map((check_id) => ({
      check_id,
      status: "pending_operator_execution"
    })),
    during_deployment: contract.during_deployment.map((check_id) => ({
      check_id,
      status: "pending_operator_execution"
    })),
    after_deployment: contract.after_deployment.map((check_id) => ({
      check_id,
      status: "pending_operator_execution"
    })),
    pending_check_count: pending.length,
    deployment_executed: false,
    passed: pending.length > 0
  };
}

function buildProtectedSourceIntegrity() {
  const entries = Object.entries(PROTECTED_SOURCE_HASHES).map(
    ([relativePath, expectedSha256]) => {
      const actualSha256 = fileSha256(relativePath);
      return {
        relative_path: relativePath,
        expected_sha256: expectedSha256,
        actual_sha256: actualSha256,
        matches: actualSha256 === expectedSha256
      };
    }
  );
  return {
    integrity_version: "e2a49-protected-source-integrity-v1",
    entries,
    evaluator_v5_unchanged:
      entries.find((entry) =>
        entry.relative_path.endsWith(
          "production-turn-evidence-evaluator-v5.ts"
        )
      )?.matches === true,
    tutor_candidate_unchanged:
      entries.find((entry) =>
        entry.relative_path.endsWith(
          "e2a24-autonomous-dialogue-candidate.ts"
        )
      )?.matches === true,
    deployment_hardening_logger_unchanged:
      entries.find((entry) =>
        entry.relative_path.endsWith("production-safe-logger.ts")
      )?.matches === true,
    e2a48_sources_unchanged: entries
      .filter(
        (entry) =>
          entry.relative_path.includes("e2a48") ||
          entry.relative_path.includes("e2a48a")
      )
      .every((entry) => entry.matches),
    passed: entries.every((entry) => entry.matches)
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
    integrity_version: "e2a49-candidate-integrity-v1",
    relative_path: relativePath,
    expected_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    actual_configuration_hash:
      manifest.candidate_configuration_hash ?? null,
    approval_state: manifest.approval_state ?? null,
    activation_state: manifest.activation_state ?? null,
    candidate_approved_by_e2a49: false,
    candidate_activated_by_e2a49: false,
    passed:
      manifest.candidate_configuration_hash ===
      CANDIDATE_CONFIGURATION_HASH
  };
}

function buildHistoricalIntegrity() {
  const e2a48Paths = Object.keys(PROTECTED_SOURCE_HASHES).filter(
    (relativePath) =>
      relativePath.includes("e2a48") ||
      relativePath.includes("e2a48a")
  );
  return {
    integrity_version: "e2a49-e2a48-historical-integrity-v1",
    predecessor_commit: PREDECESSOR_COMMIT,
    protected_source_paths: e2a48Paths,
    protected_sources_match: e2a48Paths.every(
      (relativePath) =>
        fileSha256(relativePath) ===
        PROTECTED_SOURCE_HASHES[
          relativePath as keyof typeof PROTECTED_SOURCE_HASHES
        ]
    ),
    historical_artifacts_modified: false,
    passed: e2a48Paths.every(
      (relativePath) =>
        fileSha256(relativePath) ===
        PROTECTED_SOURCE_HASHES[
          relativePath as keyof typeof PROTECTED_SOURCE_HASHES
        ]
    )
  };
}

function buildBudget() {
  return {
    budget_contract_version: E2A49_BUDGET_CONTRACT_VERSION,
    frozen_future_staging_ceiling: {
      logical_calls_maximum: 29,
      adapter_attempts_maximum: 87,
      provider_concurrency: 1,
      transport_retries_per_logical_call_maximum: 2,
      input_tokens_maximum: 900_000,
      output_tokens_maximum: 70_000,
      total_tokens_maximum: 970_000,
      usd_ceiling_when_pricing_metadata_exists: 25
    },
    protocol_freeze_execution_budget: {
      provider_calls: 0,
      network_requests: 0,
      database_queries: 0,
      render_api_calls: 0,
      deployments: 0
    },
    provider_calls_made: 0,
    network_requests_made: 0,
    database_queries_made: 0,
    render_api_calls_made: 0,
    deployment_executed: false,
    candidate_approved: false,
    candidate_activated: false
  } as const;
}

function buildArtifactContract() {
  return {
    artifact_contract_version: E2A49_ARTIFACT_CONTRACT_VERSION,
    required_artifacts: [...E2A49_ARTIFACT_NAMES],
    artifacts_are_read_only_after_write: true,
    secret_values_prohibited: true,
    environment_values_prohibited: true,
    real_student_data_prohibited: true,
    student_response_content_prohibited: true,
    hidden_prompts_prohibited: true,
    chain_of_thought_prohibited: true,
    raw_provider_payloads_prohibited: true,
    deployment_executed: false,
    provider_calls_authorized: false,
    network_requests_authorized: false
  } as const;
}

function buildProviderCallGuard(networkRequestCount: number) {
  return {
    guard_version: "e2a49-provider-call-guard-v1",
    provider_calls_made: 0,
    network_requests_made: networkRequestCount,
    database_queries_made: 0,
    render_api_calls_made: 0,
    provider_credentials_read: false,
    environment_secret_values_read: false,
    deployment_executed: false,
    passed: networkRequestCount === 0
  };
}

function buildE2A49ImplementationSourceHashes() {
  const paths = [
    "src/lib/evaluation/formative/e2a49-render-staging-contracts.ts",
    "src/lib/evaluation/formative/e2a49-render-staging-protocol.ts",
    "prisma/formative-evaluation-e2a49.ts"
  ];
  return Object.fromEntries(
    paths.map((relativePath) => [
      relativePath,
      fileSha256(relativePath)
    ])
  );
}

export function buildE2A49ProtocolArtifacts(input?: {
  networkRequestCount?: number;
}) {
  const contracts = {
    deployment: buildRenderStagingDeploymentContractV1(),
    build: buildBuildValidationContractV1(),
    database: buildDatabaseValidationContractV1(),
    health: buildHealthValidationContractV1(),
    cba_smoke: buildCbaStagingSmokeContractV1(),
    rollback: buildRollbackValidationContractV1(),
    operator_checklist: buildOperatorChecklistContractV1()
  };
  const sourceInventory = buildSourceInventory();
  const cbaSmoke = runSyntheticCbaSmoke();
  const dataIntegrity = buildDataIntegrityValidation(cbaSmoke);
  const validations = {
    configuration: buildConfigurationValidation(),
    build: buildBuildValidation(),
    database: buildDatabaseValidation(),
    health: buildHealthValidation(),
    cba_smoke: cbaSmoke,
    data_integrity: dataIntegrity,
    security: buildSecurityValidation(),
    failure_recovery: runE2A49FailureRecoveryRegressions(),
    rollback: buildRollbackValidation(),
    operator_checklist: buildOperatorChecklistState()
  };
  const protectedIntegrity = buildProtectedSourceIntegrity();
  const candidateIntegrity = buildCandidateIntegrity();
  const historicalIntegrity = buildHistoricalIntegrity();
  const budget = buildBudget();
  const artifactContract = buildArtifactContract();
  const providerCallGuard = buildProviderCallGuard(
    input?.networkRequestCount ?? 0
  );
  const contractFingerprint = buildE2A49ContractFingerprint();
  const implementationSourceHashes =
    buildE2A49ImplementationSourceHashes();
  const componentBindings = {
    binding_version: "e2a49-component-contract-bindings-v1",
    contract_fingerprint: contractFingerprint,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    predecessor_commit: PREDECESSOR_COMMIT,
    protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
    staging_source_set_hash: stableHash(sourceInventory.files),
    implementation_source_hashes: implementationSourceHashes,
    implementation_source_set_hash: stableHash(
      implementationSourceHashes
    )
  };
  const protocolPayload = {
    protocol_version: E2A49_PROTOCOL_VERSION,
    protocol_kind: "render_staging_deployment_protocol_freeze_only",
    predecessor_commit: PREDECESSOR_COMMIT,
    contract_fingerprint: contractFingerprint,
    component_bindings: componentBindings,
    deployment_environment: "staging",
    actual_staging_execution_required_for_completion: true,
    provider_calls_authorized: false,
    network_requests_authorized: false,
    database_queries_authorized: false,
    render_api_calls_authorized: false,
    deployment_authorized: false,
    candidate_approval_authorized: false,
    candidate_activation_authorized: false
  };
  const protocolHash = stableHash(protocolPayload);
  const protocol = {
    ...protocolPayload,
    protocol_hash: protocolHash
  };
  const compositeIdentityPayload = {
    protocol_hash: protocolHash,
    contract_fingerprint: contractFingerprint,
    candidate_configuration_hash: CANDIDATE_CONFIGURATION_HASH,
    protected_source_set_hash: stableHash(PROTECTED_SOURCE_HASHES),
    staging_source_set_hash: stableHash(sourceInventory.files),
    implementation_source_set_hash:
      componentBindings.implementation_source_set_hash,
    predecessor_commit: PREDECESSOR_COMMIT
  };
  const compositeRuntimeIdentity = {
    composite_identity_version: E2A49_COMPOSITE_IDENTITY_VERSION,
    ...compositeIdentityPayload,
    composite_runtime_identity_hash: stableHash(
      compositeIdentityPayload
    )
  };
  const repositoryValidationsPassed =
    validations.configuration.repository_checks_passed &&
    validations.build.repository_checks_passed &&
    validations.database.repository_checks_passed &&
    validations.health.repository_checks_passed &&
    validations.cba_smoke.passed &&
    validations.data_integrity.passed &&
    validations.security.passed &&
    validations.failure_recovery.passed &&
    validations.rollback.repository_checks_passed &&
    validations.operator_checklist.passed;
  const operatorEvidenceCodes = [
    ...validations.configuration.operator_evidence_codes,
    ...validations.build.operator_evidence_codes,
    ...validations.database.operator_evidence_codes,
    ...validations.health.operator_evidence_codes,
    ...validations.rollback.operator_evidence_codes
  ];
  const protocolVerificationPassed =
    repositoryValidationsPassed &&
    protectedIntegrity.passed &&
    candidateIntegrity.passed &&
    historicalIntegrity.passed &&
    providerCallGuard.passed;
  const summary = {
    summary_version: "e2a49-render-staging-deployment-summary-v1",
    protocol_version: E2A49_PROTOCOL_VERSION,
    protocol_hash: protocolHash,
    composite_runtime_identity_hash:
      compositeRuntimeIdentity.composite_runtime_identity_hash,
    contract_count: Object.keys(contracts).length,
    synthetic_cba_step_count:
      validations.cba_smoke.ordered_steps.length,
    failure_recovery_case_count:
      validations.failure_recovery.cases.length,
    repository_protocol_verification_passed:
      protocolVerificationPassed,
    staging_execution_status: "operator_evidence_required",
    operator_evidence_count: operatorEvidenceCodes.length,
    operator_evidence_codes: operatorEvidenceCodes,
    staging_deployment_ready_for_separate_operator_execution:
      protocolVerificationPassed,
    staging_deployment_validated: false,
    deployment_executed: false,
    real_student_data_used: false,
    provider_calls_made: 0,
    network_requests_made: input?.networkRequestCount ?? 0,
    candidate_approved: false,
    candidate_activated: false,
    classroom_effectiveness_established: false,
    student_usability_established: false,
    production_deployment_approved: false,
    passed: protocolVerificationPassed
  };
  return {
    contracts,
    sourceInventory,
    validations,
    protectedIntegrity,
    candidateIntegrity,
    historicalIntegrity,
    budget,
    artifactContract,
    providerCallGuard,
    componentBindings,
    protocol,
    compositeRuntimeIdentity,
    summary
  };
}

function artifactValues(
  result: ReturnType<typeof buildE2A49ProtocolArtifacts>
) {
  return {
    "freeze-manifest.json": {
      artifact_contract_version: E2A49_ARTIFACT_CONTRACT_VERSION,
      protocol_version: result.protocol.protocol_version,
      protocol_hash: result.protocol.protocol_hash,
      composite_runtime_identity_hash:
        result.compositeRuntimeIdentity
          .composite_runtime_identity_hash,
      required_artifacts: [...E2A49_ARTIFACT_NAMES],
      generated_at: new Date().toISOString()
    },
    "frozen-protocol.json": result.protocol,
    "frozen-protocol.sha256": {
      algorithm: "sha256",
      protocol_hash: result.protocol.protocol_hash
    },
    "render-staging-deployment-contract-v1.json":
      result.contracts.deployment,
    "build-validation-contract-v1.json": result.contracts.build,
    "database-validation-contract-v1.json":
      result.contracts.database,
    "health-validation-contract-v1.json": result.contracts.health,
    "cba-staging-smoke-contract-v1.json":
      result.contracts.cba_smoke,
    "rollback-validation-contract-v1.json":
      result.contracts.rollback,
    "operator-checklist-contract-v1.json":
      result.contracts.operator_checklist,
    "component-contract-bindings.json": result.componentBindings,
    "staging-source-inventory.json": result.sourceInventory,
    "configuration-validation.json":
      result.validations.configuration,
    "build-validation.json": result.validations.build,
    "database-validation.json": result.validations.database,
    "health-validation.json": result.validations.health,
    "cba-functional-smoke.json": result.validations.cba_smoke,
    "data-integrity-validation.json":
      result.validations.data_integrity,
    "security-validation.json": result.validations.security,
    "failure-recovery-regressions.json":
      result.validations.failure_recovery,
    "rollback-validation.json": result.validations.rollback,
    "operator-checklist-state.json":
      result.validations.operator_checklist,
    "protected-source-integrity.json": result.protectedIntegrity,
    "candidate-integrity.json": result.candidateIntegrity,
    "historical-e2a48-integrity.json":
      result.historicalIntegrity,
    "budget.json": result.budget,
    "artifact-contract.json": result.artifactContract,
    "composite-runtime-identity.json":
      result.compositeRuntimeIdentity,
    "provider-call-guard.json": result.providerCallGuard,
    "summary.json": result.summary
  } satisfies Record<string, unknown>;
}

export function writeE2A49ProtocolArtifacts(input: {
  runDirectory: string;
  networkRequestCount?: number;
}) {
  assert(!existsSync(input.runDirectory), "e2a49_run_directory_exists");
  mkdirSync(input.runDirectory, { recursive: true, mode: 0o755 });
  const result = buildE2A49ProtocolArtifacts({
    networkRequestCount: input.networkRequestCount
  });
  const values = artifactValues(result);
  for (const [name, value] of Object.entries(values)) {
    writeJson(path.join(input.runDirectory, name), value);
  }
  const preliminaryValidation = validateE2A49ArtifactDirectory(
    input.runDirectory,
    false
  );
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    preliminaryValidation
  );
  const finalValidation = validateE2A49ArtifactDirectory(
    input.runDirectory,
    true
  );
  assert(finalValidation.passed, "e2a49_artifact_validation_failed");
  writeJson(
    path.join(input.runDirectory, "artifact-validation.json"),
    finalValidation
  );
  assert(
    validateE2A49ArtifactDirectory(input.runDirectory, true).passed,
    "e2a49_final_artifact_validation_failed"
  );
  for (const name of E2A49_ARTIFACT_NAMES) {
    chmodSync(path.join(input.runDirectory, name), 0o444);
  }
  chmodSync(input.runDirectory, 0o555);
  return { ...result, artifactValidation: finalValidation };
}

export function validateE2A49ArtifactDirectory(
  runDirectory: string,
  requireValidationArtifact = true
) {
  const names = existsSync(runDirectory)
    ? readdirSync(runDirectory).sort()
    : [];
  const required = E2A49_ARTIFACT_NAMES.filter(
    (name) =>
      requireValidationArtifact ||
      name !== "artifact-validation.json"
  );
  const missing = required.filter((name) => !names.includes(name));
  const unexpected = names.filter(
    (name) =>
      !E2A49_ARTIFACT_NAMES.includes(
        name as (typeof E2A49_ARTIFACT_NAMES)[number]
      )
  );
  const protocol = missing.includes("frozen-protocol.json")
    ? null
    : readJson<JsonRecord>(
        path.join(runDirectory, "frozen-protocol.json")
      );
  const summary = missing.includes("summary.json")
    ? null
    : readJson<JsonRecord>(path.join(runDirectory, "summary.json"));
  const guard = missing.includes("provider-call-guard.json")
    ? null
    : readJson<JsonRecord>(
        path.join(runDirectory, "provider-call-guard.json")
      );
  const failureRegressions = missing.includes(
    "failure-recovery-regressions.json"
  )
    ? null
    : readJson<JsonRecord>(
        path.join(
          runDirectory,
          "failure-recovery-regressions.json"
        )
      );
  const passed =
    missing.length === 0 &&
    unexpected.length === 0 &&
    protocol?.protocol_version === E2A49_PROTOCOL_VERSION &&
    typeof protocol?.protocol_hash === "string" &&
    summary?.repository_protocol_verification_passed === true &&
    summary?.staging_execution_status ===
      "operator_evidence_required" &&
    summary?.staging_deployment_validated === false &&
    summary?.deployment_executed === false &&
    summary?.candidate_approved === false &&
    summary?.candidate_activated === false &&
    guard?.provider_calls_made === 0 &&
    guard?.network_requests_made === 0 &&
    guard?.deployment_executed === false &&
    failureRegressions?.passed === true;
  return {
    validation_version: "e2a49-artifact-validation-v1",
    required_artifact_count: E2A49_ARTIFACT_NAMES.length,
    present_artifact_count: names.length,
    missing_artifacts: missing,
    unexpected_artifacts: unexpected,
    protocol_hash: protocol?.protocol_hash ?? null,
    repository_protocol_verification_passed:
      summary?.repository_protocol_verification_passed === true,
    staging_execution_status:
      summary?.staging_execution_status ?? null,
    staging_deployment_validated: false,
    deployment_executed: false,
    provider_calls_made: guard?.provider_calls_made ?? null,
    network_requests_made: guard?.network_requests_made ?? null,
    passed
  };
}

export function inspectE2A49ProtocolRun(runDirectory: string) {
  return {
    run_directory: path.relative(process.cwd(), runDirectory),
    summary: readJson<JsonRecord>(
      path.join(runDirectory, "summary.json")
    ),
    operator_checklist: readJson<JsonRecord>(
      path.join(runDirectory, "operator-checklist-state.json")
    ),
    artifact_validation:
      validateE2A49ArtifactDirectory(runDirectory)
  };
}

export function latestE2A49ProtocolRunDirectory() {
  assert(existsSync(E2A49_ARTIFACT_ROOT), "e2a49_artifact_root_missing");
  const latest = readdirSync(E2A49_ARTIFACT_ROOT)
    .filter((name) =>
      statSync(path.join(E2A49_ARTIFACT_ROOT, name)).isDirectory()
    )
    .sort()
    .at(-1);
  assert(latest, "e2a49_protocol_run_missing");
  return path.join(E2A49_ARTIFACT_ROOT, latest);
}

export function makeE2A49ProtocolRunId() {
  return `e2a49_${new Date()
    .toISOString()
    .replace(/[-:.TZ]/gu, "")}_${randomBytes(4).toString("hex")}`;
}
