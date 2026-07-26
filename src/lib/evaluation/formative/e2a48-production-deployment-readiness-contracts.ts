import { stableHash } from "@/lib/operational/stable-hash";

export const DEPLOYMENT_ENVIRONMENT_AUDIT_VERSION =
  "deployment-environment-audit-v1" as const;
export const DEPLOYMENT_ENVIRONMENT_AUDIT_CONTRACT_VERSION =
  "deployment-environment-audit-contract-v1" as const;
export const PRODUCTION_DATABASE_READINESS_VERSION =
  "production-database-readiness-v1" as const;
export const DATABASE_READINESS_CONTRACT_VERSION =
  "database-readiness-contract-v1" as const;
export const DEPLOYMENT_BUILD_READINESS_VERSION =
  "deployment-build-readiness-v1" as const;
export const BUILD_READINESS_CONTRACT_VERSION =
  "build-readiness-contract-v1" as const;
export const PRODUCTION_RUNTIME_INTEGRITY_VERSION =
  "production-runtime-integrity-v1" as const;
export const RUNTIME_INTEGRITY_CONTRACT_VERSION =
  "runtime-integrity-contract-v1" as const;
export const DEPLOYMENT_SECURITY_READINESS_VERSION =
  "deployment-security-readiness-v1" as const;
export const SECURITY_READINESS_CONTRACT_VERSION =
  "security-readiness-contract-v1" as const;
export const DEPLOYMENT_OBSERVABILITY_READINESS_VERSION =
  "deployment-observability-readiness-v1" as const;
export const OBSERVABILITY_READINESS_CONTRACT_VERSION =
  "observability-readiness-contract-v1" as const;
export const RENDER_DEPLOYMENT_READINESS_VERSION =
  "render-deployment-readiness-v1" as const;
export const RENDER_READINESS_CONTRACT_VERSION =
  "render-readiness-contract-v1" as const;

export type AuditCheck = {
  check_id: string;
  passed: boolean;
  severity: "blocking" | "manual_evidence" | "informational";
  safe_detail: string;
};

export type AuditResult = {
  contract_version: string;
  audit_version: string;
  checks: AuditCheck[];
  blocking_issue_codes: string[];
  manual_evidence_codes: string[];
  passed: boolean;
};

function result(
  contractVersion: string,
  auditVersion: string,
  checks: AuditCheck[]
): AuditResult {
  return {
    contract_version: contractVersion,
    audit_version: auditVersion,
    checks,
    blocking_issue_codes: checks
      .filter((check) => !check.passed && check.severity === "blocking")
      .map((check) => check.check_id),
    manual_evidence_codes: checks
      .filter((check) => !check.passed && check.severity === "manual_evidence")
      .map((check) => check.check_id),
    passed: checks.every(
      (check) => check.passed || check.severity !== "blocking"
    )
  };
}

export function buildDeploymentEnvironmentAuditContractV1() {
  return {
    contract_version: DEPLOYMENT_ENVIRONMENT_AUDIT_CONTRACT_VERSION,
    audit_version: DEPLOYMENT_ENVIRONMENT_AUDIT_VERSION,
    required_render_variables: [
      "NODE_ENV",
      "NODE_VERSION",
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
    ],
    feature_conditional_variables: [
      "RESEARCH_PSEUDONYMIZATION_KEY",
      "OPERATIONAL_AGENT_MODE",
      "OPERATIONAL_APPROVED_CONFIG_HASH",
      "OPERATIONAL_APPROVAL_BUNDLE_PATH"
    ],
    server_only_secret_variables: [
      "DATABASE_URL",
      "SESSION_SECRET",
      "OPENAI_API_KEY",
      "RESEARCH_PSEUDONYMIZATION_KEY"
    ],
    allowed_public_variables: ["NEXT_PUBLIC_APP_BASE_URL"],
    prohibited_production_settings: {
      NODE_ENV: ["development", "test"],
      APP_ENV: ["local"],
      LLM_PROVIDER: ["mock"],
      ALLOW_LOCAL_MOCK_RUNTIME: ["true"],
      DEVELOPMENT_ACTIVE_SESSION_CONTROLS_ENABLED: ["true"]
    },
    storage_requirements: [
      "database_uses_managed_postgresql",
      "generated_exports_are_not_public_web_assets",
      "production_exports_are_downloaded_or_moved_to_approved_durable_storage",
      "database_backup_and_restore_are_operator_verified"
    ],
    secret_values_must_never_be_serialized: true,
    environment_values_are_not_read_by_protocol_freeze: true
  } as const;
}

export function auditDeploymentEnvironment(input: {
  render_variable_names: string[];
  hardcoded_secret_variable_names: string[];
  public_secret_variable_names: string[];
  tracked_env_files: string[];
  production_settings_explicit: boolean;
  development_setting_leaks: string[];
  durable_storage_operator_evidence_present: boolean;
  production_environment_values_verified: boolean;
}) {
  const contract = buildDeploymentEnvironmentAuditContractV1();
  const missing = contract.required_render_variables.filter(
    (name) => !input.render_variable_names.includes(name)
  );
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "required_environment_variables_declared",
        passed: missing.length === 0,
        severity: "blocking",
        safe_detail:
          missing.length === 0
            ? "All required variable names are declared."
            : `Missing variable names: ${missing.join(", ")}`
      },
      {
        check_id: "secret_values_not_hardcoded",
        passed:
          input.hardcoded_secret_variable_names.length === 0 &&
          input.tracked_env_files.length === 0,
        severity: "blocking",
        safe_detail: "Only variable names and safe source references are reported."
      },
      {
        check_id: "no_public_secret_variable_names",
        passed: input.public_secret_variable_names.length === 0,
        severity: "blocking",
        safe_detail: "Browser-visible configuration is limited to public app origin."
      },
      {
        check_id: "production_settings_explicit",
        passed: input.production_settings_explicit,
        severity: "blocking",
        safe_detail: "Production mode, provider mode, and local mock policy are explicit."
      },
      {
        check_id: "development_only_settings_absent",
        passed: input.development_setting_leaks.length === 0,
        severity: "blocking",
        safe_detail:
          input.development_setting_leaks.length === 0
            ? "No enabled development-only setting was found."
            : `Development-only setting names: ${input.development_setting_leaks.join(", ")}`
      },
      {
        check_id: "production_environment_values_verified",
        passed: input.production_environment_values_verified,
        severity: "manual_evidence",
        safe_detail: "Actual values must be verified in the hosting secret manager."
      },
      {
        check_id: "durable_storage_and_backup_verified",
        passed: input.durable_storage_operator_evidence_present,
        severity: "manual_evidence",
        safe_detail: "Backup, restore, and durable export handling require operator evidence."
      }
    ]
  );
}

export function buildDatabaseReadinessContractV1() {
  return {
    contract_version: DATABASE_READINESS_CONTRACT_VERSION,
    audit_version: PRODUCTION_DATABASE_READINESS_VERSION,
    required_controls: [
      "prisma_schema_exists",
      "prisma_schema_validates",
      "ordered_migration_directories",
      "render_predeploy_uses_prisma_migrate_deploy",
      "health_route_checks_database_and_schema",
      "seed_is_not_automatic_on_deploy",
      "destructive_migrations_require_backup_and_manual_review"
    ],
    prohibited_deployment_commands: [
      "prisma migrate dev",
      "prisma migrate reset",
      "prisma db push",
      "prisma seed"
    ],
    actual_database_state_requires_external_evidence: true,
    production_reset_prohibited: true
  } as const;
}

export function auditDatabaseReadiness(input: {
  schema_present: boolean;
  schema_validation_declared: boolean;
  migration_count: number;
  migration_names_are_ordered: boolean;
  duplicate_migration_names: string[];
  render_uses_migrate_deploy: boolean;
  unsafe_deploy_commands: string[];
  automatic_seed_on_deploy: boolean;
  health_checks_schema: boolean;
  destructive_migration_references: string[];
  backup_and_restore_operator_evidence_present: boolean;
  production_migration_status_verified: boolean;
}) {
  const contract = buildDatabaseReadinessContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "prisma_schema_and_validation",
        passed: input.schema_present && input.schema_validation_declared,
        severity: "blocking",
        safe_detail: "Prisma schema and deterministic validation entrypoint are present."
      },
      {
        check_id: "migration_sequence_is_ordered",
        passed:
          input.migration_count > 0 &&
          input.migration_names_are_ordered &&
          input.duplicate_migration_names.length === 0,
        severity: "blocking",
        safe_detail: `${input.migration_count} migration directories were inspected.`
      },
      {
        check_id: "production_migration_command_is_safe",
        passed:
          input.render_uses_migrate_deploy &&
          input.unsafe_deploy_commands.length === 0 &&
          !input.automatic_seed_on_deploy,
        severity: "blocking",
        safe_detail: "Deploy uses migrate deploy and does not automatically seed or reset."
      },
      {
        check_id: "runtime_schema_health_gate_exists",
        passed: input.health_checks_schema,
        severity: "blocking",
        safe_detail: "Health route reports database reachability and schema readiness."
      },
      {
        check_id: "historical_destructive_migrations_reviewed",
        passed:
          input.destructive_migration_references.length === 0 ||
          input.backup_and_restore_operator_evidence_present,
        severity: "manual_evidence",
        safe_detail: `${input.destructive_migration_references.length} migration files require backup-aware review.`
      },
      {
        check_id: "production_migration_status_verified",
        passed: input.production_migration_status_verified,
        severity: "manual_evidence",
        safe_detail: "Production database migration status was not queried by this no-network audit."
      }
    ]
  );
}

export function buildBuildReadinessContractV1() {
  return {
    contract_version: BUILD_READINESS_CONTRACT_VERSION,
    audit_version: DEPLOYMENT_BUILD_READINESS_VERSION,
    required_node_major: 22,
    required_scripts: [
      "build",
      "start",
      "prisma:generate",
      "prisma:migrate:deploy"
    ],
    required_render_build_steps: [
      "npm ci --include=dev",
      "npm run prisma:generate",
      "npm run build"
    ],
    required_render_start_command: "npm run start",
    generated_assets: [".next", "build/application-build-info.json"],
    startup_gate: "/api/health",
    production_build_must_be_reproduced_during_verification: true
  } as const;
}

export function auditBuildReadiness(input: {
  node_major: number | null;
  missing_scripts: string[];
  render_build_steps_present: boolean;
  render_start_command_valid: boolean;
  css_build_dependencies_available: boolean;
  application_build_provenance_declared: boolean;
  docker_runner_copies_build_artifact: boolean;
  health_check_path_valid: boolean;
  paid_resource_plan_declared: boolean;
  resource_capacity_operator_evidence_present: boolean;
  production_build_verified: boolean;
}) {
  const contract = buildBuildReadinessContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "node_version_supported",
        passed: input.node_major === contract.required_node_major,
        severity: "blocking",
        safe_detail: `Declared Node major: ${input.node_major ?? "missing"}.`
      },
      {
        check_id: "deployment_scripts_present",
        passed: input.missing_scripts.length === 0,
        severity: "blocking",
        safe_detail:
          input.missing_scripts.length === 0
            ? "Required scripts are present."
            : `Missing scripts: ${input.missing_scripts.join(", ")}`
      },
      {
        check_id: "render_build_and_start_commands_valid",
        passed:
          input.render_build_steps_present &&
          input.render_start_command_valid &&
          input.css_build_dependencies_available,
        severity: "blocking",
        safe_detail: "Render installs build dependencies, generates Prisma, builds, and starts Next."
      },
      {
        check_id: "build_provenance_packaged",
        passed:
          input.application_build_provenance_declared &&
          input.docker_runner_copies_build_artifact,
        severity: "blocking",
        safe_detail: "Application build provenance is generated and copied into Docker runtime."
      },
      {
        check_id: "startup_health_gate_declared",
        passed: input.health_check_path_valid,
        severity: "blocking",
        safe_detail: "Render health check points to the safe application health endpoint."
      },
      {
        check_id: "non_free_resource_plan_declared",
        passed: input.paid_resource_plan_declared,
        severity: "blocking",
        safe_detail: "A non-free web and database plan is declared."
      },
      {
        check_id: "resource_capacity_operator_verified",
        passed: input.resource_capacity_operator_evidence_present,
        severity: "manual_evidence",
        safe_detail: "Current memory, CPU, concurrency, and timeout capacity require operator evidence."
      },
      {
        check_id: "production_build_verified",
        passed: input.production_build_verified,
        severity: "blocking",
        safe_detail: "The local production build result is supplied by the verification phase."
      }
    ]
  );
}

export function buildRuntimeIntegrityContractV1() {
  return {
    contract_version: RUNTIME_INTEGRITY_CONTRACT_VERSION,
    audit_version: PRODUCTION_RUNTIME_INTEGRITY_VERSION,
    protected_components: [
      "evaluator_v5",
      "tutor_candidate",
      "evidence_pipeline",
      "learning_profiles",
      "engagement_profiles",
      "intervention_memory",
      "stopping_policy",
      "teacher_workflows",
      "classroom_data_architecture"
    ],
    prohibited_runtime_dependencies: [
      "prisma_test_fixture",
      "synthetic_student_fixture",
      "local_data_artifact",
      "mock_provider_without_explicit_opt_in"
    ],
    runtime_configuration_must_fail_closed: true
  } as const;
}

export function auditRuntimeIntegrity(input: {
  protected_hash_mismatches: string[];
  production_mode_explicit: boolean;
  local_mock_disabled: boolean;
  runtime_fixture_imports: string[];
  local_artifact_imports: string[];
  candidate_configuration_hash_matches: boolean;
}) {
  const contract = buildRuntimeIntegrityContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "protected_component_hashes_match",
        passed: input.protected_hash_mismatches.length === 0,
        severity: "blocking",
        safe_detail:
          input.protected_hash_mismatches.length === 0
            ? "All protected source hashes match."
            : `Mismatched source paths: ${input.protected_hash_mismatches.join(", ")}`
      },
      {
        check_id: "candidate_configuration_integrity",
        passed: input.candidate_configuration_hash_matches,
        severity: "blocking",
        safe_detail: "Candidate configuration file and frozen configuration hash remain bound."
      },
      {
        check_id: "production_mode_is_explicit",
        passed: input.production_mode_explicit && input.local_mock_disabled,
        severity: "blocking",
        safe_detail: "Production mode is explicit and local mock runtime is disabled."
      },
      {
        check_id: "no_runtime_test_fixture_dependency",
        passed:
          input.runtime_fixture_imports.length === 0 &&
          input.local_artifact_imports.length === 0,
        severity: "blocking",
        safe_detail: "Production entrypoint imports were scanned for fixture and local-artifact dependencies."
      }
    ]
  );
}

export function buildSecurityReadinessContractV1() {
  return {
    contract_version: SECURITY_READINESS_CONTRACT_VERSION,
    audit_version: DEPLOYMENT_SECURITY_READINESS_VERSION,
    prohibited_material: [
      "credentials",
      "database_urls",
      "session_secrets",
      "api_keys",
      "student_private_data",
      "raw_provider_payloads",
      "hidden_prompts",
      "chain_of_thought",
      "hidden_model_reasoning"
    ],
    log_allowlist: [
      "safe_error_code",
      "error_type",
      "public_identifier",
      "status",
      "count",
      "timestamp"
    ],
    e2a44_student_privacy_boundary_required: true,
    e2a45_teacher_research_boundary_required: true
  } as const;
}

export function auditSecurityReadiness(input: {
  committed_secret_references: string[];
  tracked_env_files: string[];
  unsafe_log_references: string[];
  health_route_secret_safe: boolean;
  student_privacy_boundary_bound: boolean;
  teacher_research_boundary_bound: boolean;
}) {
  const contract = buildSecurityReadinessContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "no_committed_secret_values",
        passed:
          input.committed_secret_references.length === 0 &&
          input.tracked_env_files.length === 0,
        severity: "blocking",
        safe_detail: "Tracked deployment surfaces were scanned without serializing matched values."
      },
      {
        check_id: "unsafe_raw_error_logging_absent",
        passed: input.unsafe_log_references.length === 0,
        severity: "blocking",
        safe_detail:
          input.unsafe_log_references.length === 0
            ? "No raw unknown-error logging reference was found."
            : `${input.unsafe_log_references.length} source references require sanitized logging.`
      },
      {
        check_id: "health_response_is_secret_safe",
        passed: input.health_route_secret_safe,
        severity: "blocking",
        safe_detail: "Health response contains safe status fields only."
      },
      {
        check_id: "e2a44_e2a45_data_boundaries_bound",
        passed:
          input.student_privacy_boundary_bound &&
          input.teacher_research_boundary_bound,
        severity: "blocking",
        safe_detail: "Student privacy and teacher/research visibility contracts are integrity-bound."
      }
    ]
  );
}

export function buildObservabilityReadinessContractV1() {
  return {
    contract_version: OBSERVABILITY_READINESS_CONTRACT_VERSION,
    audit_version: DEPLOYMENT_OBSERVABILITY_READINESS_VERSION,
    required_signals: [
      "health_status",
      "database_reachability",
      "database_schema_readiness",
      "agent_call_status",
      "provider_error_category",
      "client_request_id",
      "workflow_retry_status",
      "safe_recovery_instruction"
    ],
    raw_error_payloads_prohibited: true,
    raw_provider_payloads_prohibited: true,
    identifiers_must_be_public_or_pseudonymous: true
  } as const;
}

export function auditObservabilityReadiness(input: {
  health_signals_present: boolean;
  agent_failure_fields_present: boolean;
  request_trace_fields_present: boolean;
  workflow_recovery_fields_present: boolean;
  raw_error_logging_references: string[];
}) {
  const contract = buildObservabilityReadinessContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "health_and_database_signals_present",
        passed: input.health_signals_present,
        severity: "blocking",
        safe_detail: "Health endpoint exposes safe readiness booleans and status labels."
      },
      {
        check_id: "agent_failure_and_request_trace_present",
        passed:
          input.agent_failure_fields_present &&
          input.request_trace_fields_present,
        severity: "blocking",
        safe_detail: "Agent failures and client request IDs are persisted for audit."
      },
      {
        check_id: "workflow_recovery_signals_present",
        passed: input.workflow_recovery_fields_present,
        severity: "blocking",
        safe_detail: "Workflow jobs persist retry scheduling and safe error categories."
      },
      {
        check_id: "observability_is_sanitized",
        passed: input.raw_error_logging_references.length === 0,
        severity: "blocking",
        safe_detail:
          input.raw_error_logging_references.length === 0
            ? "Observed errors are represented by safe fields."
            : "Raw Error object logging must be replaced before production."
      }
    ]
  );
}

export function buildRenderReadinessContractV1() {
  return {
    contract_version: RENDER_READINESS_CONTRACT_VERSION,
    audit_version: RENDER_DEPLOYMENT_READINESS_VERSION,
    deployment_order: [
      "build_clean_commit",
      "generate_prisma_client",
      "build_next_application",
      "backup_database",
      "deploy_migrations",
      "start_service",
      "verify_health",
      "run_synthetic_browser_dry_run"
    ],
    database_attachment: "fromDatabase.connectionString",
    health_check_path: "/api/health",
    automatic_seed_prohibited: true,
    automatic_bootstrap_prohibited: true,
    rollback_requirements: [
      "previous_commit_available",
      "previous_approved_configuration_available",
      "database_backup_available",
      "restore_drill_completed",
      "operator_rollback_steps_documented"
    ]
  } as const;
}

export function auditRenderReadiness(input: {
  native_node_service: boolean;
  database_attached: boolean;
  build_command_valid: boolean;
  predeploy_command_valid: boolean;
  start_command_valid: boolean;
  health_check_valid: boolean;
  secrets_use_manual_or_database_sources: boolean;
  auto_deploy_disabled: boolean;
  rollback_documented: boolean;
  backup_restore_evidence_present: boolean;
}) {
  const contract = buildRenderReadinessContractV1();
  return result(
    contract.contract_version,
    contract.audit_version,
    [
      {
        check_id: "render_service_and_database_declared",
        passed: input.native_node_service && input.database_attached,
        severity: "blocking",
        safe_detail: "Blueprint declares a native Node service and managed PostgreSQL attachment."
      },
      {
        check_id: "render_deployment_order_valid",
        passed:
          input.build_command_valid &&
          input.predeploy_command_valid &&
          input.start_command_valid &&
          input.health_check_valid,
        severity: "blocking",
        safe_detail: "Build, migration, start, and health commands are ordered explicitly."
      },
      {
        check_id: "render_secrets_are_external",
        passed: input.secrets_use_manual_or_database_sources,
        severity: "blocking",
        safe_detail: "Secret and deployment-specific values are not committed in the Blueprint."
      },
      {
        check_id: "render_release_is_operator_controlled",
        passed: input.auto_deploy_disabled,
        severity: "blocking",
        safe_detail: "Automatic deployment is disabled."
      },
      {
        check_id: "rollback_is_documented",
        passed: input.rollback_documented,
        severity: "blocking",
        safe_detail: "Rollback steps and prior approved configuration preservation are documented."
      },
      {
        check_id: "backup_restore_evidence_present",
        passed: input.backup_restore_evidence_present,
        severity: "manual_evidence",
        safe_detail: "A real backup and restore drill requires external operator evidence."
      }
    ]
  );
}

export function buildE2A48ContractFingerprint() {
  return stableHash({
    environment: buildDeploymentEnvironmentAuditContractV1(),
    database: buildDatabaseReadinessContractV1(),
    build: buildBuildReadinessContractV1(),
    runtime: buildRuntimeIntegrityContractV1(),
    security: buildSecurityReadinessContractV1(),
    observability: buildObservabilityReadinessContractV1(),
    render: buildRenderReadinessContractV1()
  });
}

export function runE2A48RequiredRegressions() {
  const safeEnvironment = {
    render_variable_names: [
      ...buildDeploymentEnvironmentAuditContractV1().required_render_variables
    ],
    hardcoded_secret_variable_names: [],
    public_secret_variable_names: [],
    tracked_env_files: [],
    production_settings_explicit: true,
    development_setting_leaks: [],
    durable_storage_operator_evidence_present: false,
    production_environment_values_verified: false
  };
  const runtimeBase = {
    protected_hash_mismatches: [],
    production_mode_explicit: true,
    local_mock_disabled: true,
    runtime_fixture_imports: [],
    local_artifact_imports: [],
    candidate_configuration_hash_matches: true
  };
  const cases = [
    {
      case_id: "missing_environment_variable_detection",
      detected: !auditDeploymentEnvironment({
        ...safeEnvironment,
        render_variable_names: safeEnvironment.render_variable_names.filter(
          (name) => name !== "SESSION_SECRET"
        )
      }).passed
    },
    {
      case_id: "missing_database_configuration",
      detected: !auditRenderReadiness({
        native_node_service: true,
        database_attached: false,
        build_command_valid: true,
        predeploy_command_valid: true,
        start_command_valid: true,
        health_check_valid: true,
        secrets_use_manual_or_database_sources: true,
        auto_deploy_disabled: true,
        rollback_documented: true,
        backup_restore_evidence_present: false
      }).passed
    },
    {
      case_id: "production_build_failure_detection",
      detected: !auditBuildReadiness({
        node_major: 22,
        missing_scripts: [],
        render_build_steps_present: true,
        render_start_command_valid: true,
        css_build_dependencies_available: true,
        application_build_provenance_declared: true,
        docker_runner_copies_build_artifact: true,
        health_check_path_valid: true,
        paid_resource_plan_declared: true,
        resource_capacity_operator_evidence_present: true,
        production_build_verified: false
      }).passed
    },
    {
      case_id: "secret_leakage_detection",
      detected: !auditDeploymentEnvironment({
        ...safeEnvironment,
        hardcoded_secret_variable_names: ["OPENAI_API_KEY"]
      }).passed
    },
    {
      case_id: "development_configuration_leakage",
      detected: !auditDeploymentEnvironment({
        ...safeEnvironment,
        development_setting_leaks: ["ALLOW_LOCAL_MOCK_RUNTIME"]
      }).passed
    },
    {
      case_id: "protected_hash_mismatch_detection",
      detected: !auditRuntimeIntegrity({
        ...runtimeBase,
        protected_hash_mismatches: ["protected/source.ts"]
      }).passed
    },
    {
      case_id: "synthetic_fixture_dependency_detection",
      detected: !auditRuntimeIntegrity({
        ...runtimeBase,
        runtime_fixture_imports: ["src/app/example.ts"]
      }).passed
    },
    {
      case_id: "unsafe_logging_detection",
      detected: !auditSecurityReadiness({
        committed_secret_references: [],
        tracked_env_files: [],
        unsafe_log_references: ["src/app/example.ts:1"],
        health_route_secret_safe: true,
        student_privacy_boundary_bound: true,
        teacher_research_boundary_bound: true
      }).passed
    },
    {
      case_id: "database_schema_mismatch_detection",
      detected: !auditDatabaseReadiness({
        schema_present: false,
        schema_validation_declared: true,
        migration_count: 1,
        migration_names_are_ordered: true,
        duplicate_migration_names: [],
        render_uses_migrate_deploy: true,
        unsafe_deploy_commands: [],
        automatic_seed_on_deploy: false,
        health_checks_schema: true,
        destructive_migration_references: [],
        backup_and_restore_operator_evidence_present: false,
        production_migration_status_verified: false
      }).passed
    },
    {
      case_id: "startup_command_validation",
      detected: !auditBuildReadiness({
        node_major: 22,
        missing_scripts: [],
        render_build_steps_present: true,
        render_start_command_valid: false,
        css_build_dependencies_available: true,
        application_build_provenance_declared: true,
        docker_runner_copies_build_artifact: true,
        health_check_path_valid: true,
        paid_resource_plan_declared: true,
        resource_capacity_operator_evidence_present: true,
        production_build_verified: true
      }).passed
    },
    {
      case_id: "runtime_integrity_validation",
      detected: !auditRuntimeIntegrity({
        ...runtimeBase,
        candidate_configuration_hash_matches: false
      }).passed
    },
    {
      case_id: "rollback_readiness_validation",
      detected: !auditRenderReadiness({
        native_node_service: true,
        database_attached: true,
        build_command_valid: true,
        predeploy_command_valid: true,
        start_command_valid: true,
        health_check_valid: true,
        secrets_use_manual_or_database_sources: true,
        auto_deploy_disabled: true,
        rollback_documented: false,
        backup_restore_evidence_present: false
      }).passed
    }
  ];
  return {
    regression_version: "e2a48-required-regressions-v1",
    required_case_count: 12,
    cases,
    passed:
      cases.length === 12 && cases.every((entry) => entry.detected)
  };
}
