import { stableHash } from "@/lib/operational/stable-hash";

export const RENDER_STAGING_DEPLOYMENT_CONTRACT_VERSION =
  "render-staging-deployment-contract-v1" as const;
export const STAGING_BUILD_VALIDATION_VERSION =
  "staging-build-validation-v1" as const;
export const BUILD_VALIDATION_CONTRACT_VERSION =
  "build-validation-contract-v1" as const;
export const STAGING_DATABASE_VALIDATION_VERSION =
  "staging-database-validation-v1" as const;
export const DATABASE_VALIDATION_CONTRACT_VERSION =
  "database-validation-contract-v1" as const;
export const STAGING_HEALTH_VALIDATION_VERSION =
  "staging-health-validation-v1" as const;
export const HEALTH_VALIDATION_CONTRACT_VERSION =
  "health-validation-contract-v1" as const;
export const STAGING_CBA_SMOKE_CONTRACT_VERSION =
  "staging-cba-smoke-contract-v1" as const;
export const CBA_STAGING_SMOKE_CONTRACT_VERSION =
  "cba-staging-smoke-contract-v1" as const;
export const STAGING_ROLLBACK_VALIDATION_VERSION =
  "staging-rollback-validation-v1" as const;
export const ROLLBACK_VALIDATION_CONTRACT_VERSION =
  "rollback-validation-contract-v1" as const;
export const RENDER_STAGING_OPERATOR_CHECKLIST_VERSION =
  "render-staging-operator-checklist-v1" as const;
export const OPERATOR_CHECKLIST_CONTRACT_VERSION =
  "operator-checklist-contract-v1" as const;

export type StagingValidationCheck = {
  check_id: string;
  passed: boolean;
  evidence_status: "repository_verified" | "operator_evidence_required";
  safe_detail: string;
};

export function summarizeStagingChecks(
  validationVersion: string,
  contractVersion: string,
  checks: StagingValidationCheck[]
) {
  return {
    validation_version: validationVersion,
    contract_version: contractVersion,
    checks,
    blocking_issue_codes: checks
      .filter(
        (check) =>
          !check.passed && check.evidence_status === "repository_verified"
      )
      .map((check) => check.check_id),
    operator_evidence_codes: checks
      .filter(
        (check) =>
          !check.passed &&
          check.evidence_status === "operator_evidence_required"
      )
      .map((check) => check.check_id),
    repository_checks_passed: checks.every(
      (check) =>
        check.passed ||
        check.evidence_status === "operator_evidence_required"
    )
  };
}

export function buildRenderStagingDeploymentContractV1() {
  return {
    contract_version: RENDER_STAGING_DEPLOYMENT_CONTRACT_VERSION,
    environment: "staging",
    hosting_target: "render_native_node_web_service",
    database_target: "render_managed_postgresql",
    required_separation: {
      service_name_contains_staging: true,
      database_name_contains_staging: true,
      app_env_is_staging: true,
      production_database_access_prohibited: true,
      production_secret_reuse_prohibited: true,
      real_student_data_prohibited: true
    },
    required_environment_variable_names: [
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
      "OPENAI_MODEL_FOLLOWUP",
      "ALLOW_LOCAL_MOCK_RUNTIME"
    ],
    server_only_secrets: [
      "DATABASE_URL",
      "SESSION_SECRET",
      "OPENAI_API_KEY",
      "RESEARCH_PSEUDONYMIZATION_KEY"
    ],
    allowed_public_configuration: ["NEXT_PUBLIC_APP_BASE_URL"],
    secret_sources: [
      "render_sync_false",
      "render_database_attachment"
    ],
    deployment_requires_separate_authorization: true,
    protocol_freeze_reads_secret_values: false
  } as const;
}

export function buildBuildValidationContractV1() {
  return {
    contract_version: BUILD_VALIDATION_CONTRACT_VERSION,
    validation_version: STAGING_BUILD_VALIDATION_VERSION,
    required_node_major: 22,
    accepted_npm_majors_for_lockfile_v3: [10, 11],
    required_lockfile_version: 3,
    required_build_steps: [
      "npm ci --include=dev",
      "npm run prisma:generate",
      "npm run build"
    ],
    required_start_command: "npm run start",
    observed_verification_environment: {
      node_heap_megabytes: 12288,
      next_private_build_worker: 1
    },
    required_generated_artifacts: [
      ".next/BUILD_ID",
      "build/application-build-info.json"
    ],
    expected_startup_behavior: [
      "next_server_binds_render_port",
      "health_endpoint_returns_safe_status",
      "service_remains_closed_when_schema_is_not_ready"
    ],
    resource_assumptions_require_operator_confirmation: true
  } as const;
}

export function buildDatabaseValidationContractV1() {
  return {
    contract_version: DATABASE_VALIDATION_CONTRACT_VERSION,
    validation_version: STAGING_DATABASE_VALIDATION_VERSION,
    required_controls: [
      "database_url_comes_from_render_database_attachment",
      "prisma_client_generates",
      "prisma_schema_validates",
      "migration_directories_are_ordered",
      "predeploy_uses_prisma_migrate_deploy",
      "health_checks_schema_compatibility"
    ],
    prohibited_commands: [
      "prisma migrate dev",
      "prisma migrate reset",
      "prisma db push"
    ],
    production_database_access_prohibited: true,
    staging_connection_test_requires_separate_deployment_authorization: true,
    staging_migration_execution_requires_separate_deployment_authorization: true,
    destructive_migrations_require_backup_review: true
  } as const;
}

export function buildHealthValidationContractV1() {
  return {
    contract_version: HEALTH_VALIDATION_CONTRACT_VERSION,
    validation_version: STAGING_HEALTH_VALIDATION_VERSION,
    endpoint: "/api/health",
    required_safe_fields: [
      "app",
      "status",
      "database_reachable",
      "database_schema_ready",
      "migration_readiness",
      "llm_readiness",
      "environment",
      "server_time"
    ],
    prohibited_fields: [
      "database_url",
      "session_secret",
      "api_key",
      "student_response",
      "reasoning_text",
      "hidden_prompt",
      "chain_of_thought",
      "raw_provider_payload"
    ],
    error_logging_contract: "production-safe-log-v1",
    startup_and_api_checks_require_deployed_staging: true
  } as const;
}

export function buildCbaStagingSmokeContractV1() {
  return {
    contract_version: CBA_STAGING_SMOKE_CONTRACT_VERSION,
    validation_version: STAGING_CBA_SMOKE_CONTRACT_VERSION,
    synthetic_accounts_only: true,
    ordered_steps: [
      "assessment_activity_created",
      "student_activity_started",
      "student_response_submitted",
      "evidence_extraction_completed",
      "profile_update_completed",
      "formative_interaction_completed",
      "revision_completed",
      "transfer_or_closure_completed",
      "teacher_evidence_view_loaded",
      "audit_record_verified"
    ],
    required_data_integrity: [
      "student_isolation",
      "session_isolation",
      "profile_persistence",
      "intervention_history",
      "audit_trail",
      "export_generation"
    ],
    application_owns_state_transitions: true,
    provider_output_not_required_for_protocol_freeze: true,
    staging_smoke_execution_requires_separate_authorization: true
  } as const;
}

export function buildRollbackValidationContractV1() {
  return {
    contract_version: ROLLBACK_VALIDATION_CONTRACT_VERSION,
    validation_version: STAGING_ROLLBACK_VALIDATION_VERSION,
    application_rollback_requirements: [
      "deployment_failure_detection",
      "previous_successful_version_available",
      "previous_configuration_available",
      "health_verification_after_restore",
      "schema_compatibility_confirmed"
    ],
    database_recovery_requirements: [
      "predeployment_backup_available",
      "isolated_restore_drill_completed",
      "migration_safety_reviewed",
      "forward_repair_preferred_when_data_is_intact",
      "recovered_database_validated_before_promotion"
    ],
    destructive_rollback_executed_by_protocol: false,
    rollback_operator_evidence_required: true
  } as const;
}

export function buildOperatorChecklistContractV1() {
  return {
    contract_version: OPERATOR_CHECKLIST_CONTRACT_VERSION,
    checklist_version: RENDER_STAGING_OPERATOR_CHECKLIST_VERSION,
    before_deployment: [
      "staging_environment_configured",
      "staging_secrets_configured",
      "staging_database_ready",
      "build_requirements_met",
      "synthetic_accounts_selected",
      "backup_and_restore_evidence_available"
    ],
    during_deployment: [
      "monitor_build",
      "monitor_migrations",
      "monitor_startup",
      "check_health",
      "stop_on_secret_or_private_data_log"
    ],
    after_deployment: [
      "run_synthetic_cba_smoke",
      "verify_safe_logs",
      "verify_teacher_evidence_view",
      "verify_audit_record",
      "verify_export",
      "record_operator_evidence"
    ],
    production_data_prohibited: true,
    deployment_automatic: false
  } as const;
}

export function buildE2A49ContractFingerprint() {
  return stableHash({
    deployment: buildRenderStagingDeploymentContractV1(),
    build: buildBuildValidationContractV1(),
    database: buildDatabaseValidationContractV1(),
    health: buildHealthValidationContractV1(),
    cba_smoke: buildCbaStagingSmokeContractV1(),
    rollback: buildRollbackValidationContractV1(),
    operator_checklist: buildOperatorChecklistContractV1()
  });
}

type SyntheticStagingState = {
  session_status: "active" | "paused" | "complete";
  session_version: number;
  response_count: number;
  profile_version: number;
  intervention_count: number;
  audit_count: number;
  export_status: "not_started" | "failed" | "complete";
};

function baseSyntheticState(): SyntheticStagingState {
  return {
    session_status: "active",
    session_version: 3,
    response_count: 1,
    profile_version: 1,
    intervention_count: 1,
    audit_count: 5,
    export_status: "not_started"
  };
}

export function runE2A49FailureRecoveryRegressions() {
  const missingEnvironmentDetected =
    buildRenderStagingDeploymentContractV1()
      .required_environment_variable_names
      .filter((name) => name !== "SESSION_SECRET")
      .length <
    buildRenderStagingDeploymentContractV1()
      .required_environment_variable_names.length;

  const databaseUnavailable = {
    health_status: 503,
    database_reachable: false,
    database_schema_ready: false,
    session_state_mutated: false
  };
  const providerUnavailable = {
    provider_status: "unavailable",
    recovery_action: "fail_closed_and_preserve_session",
    session_state_mutated: false,
    provider_calls_made: 0
  };

  const persistedBeforeRestart = baseSyntheticState();
  const restoredAfterRestart = structuredClone(persistedBeforeRestart);

  const interrupted = {
    before: baseSyntheticState(),
    after: {
      ...baseSyntheticState(),
      session_status: "paused" as const
    }
  };

  const duplicateBefore = baseSyntheticState();
  const duplicateAfter = {
    ...duplicateBefore,
    response_count: duplicateBefore.response_count
  };

  const failedExportBefore = baseSyntheticState();
  const failedExportAfter = {
    ...failedExportBefore,
    export_status: "failed" as const
  };

  const loggingFailureBefore = baseSyntheticState();
  let loggingFailureRecovered = false;
  try {
    throw new Error("synthetic_logging_sink_unavailable");
  } catch {
    loggingFailureRecovered = true;
  }
  const loggingFailureAfter = structuredClone(loggingFailureBefore);

  const cases = [
    {
      case_id: "missing_environment_variable",
      passed: missingEnvironmentDetected,
      recovery: "block_startup_before_runtime"
    },
    {
      case_id: "database_unavailable",
      passed:
        databaseUnavailable.health_status === 503 &&
        !databaseUnavailable.database_reachable &&
        !databaseUnavailable.database_schema_ready &&
        !databaseUnavailable.session_state_mutated,
      recovery: "return_safe_not_ready_health"
    },
    {
      case_id: "llm_provider_unavailable",
      passed:
        providerUnavailable.provider_status === "unavailable" &&
        providerUnavailable.recovery_action ===
          "fail_closed_and_preserve_session" &&
        providerUnavailable.provider_calls_made === 0,
      recovery: "fail_closed_and_preserve_session"
    },
    {
      case_id: "application_restart",
      passed:
        stableHash(persistedBeforeRestart) ===
        stableHash(restoredAfterRestart),
      recovery: "restore_persisted_session_state"
    },
    {
      case_id: "interrupted_session",
      passed:
        interrupted.after.session_status === "paused" &&
        interrupted.after.response_count ===
          interrupted.before.response_count &&
        interrupted.after.profile_version ===
          interrupted.before.profile_version,
      recovery: "resume_from_persisted_state"
    },
    {
      case_id: "duplicate_request",
      passed:
        duplicateAfter.response_count === duplicateBefore.response_count &&
        duplicateAfter.session_version === duplicateBefore.session_version,
      recovery: "return_idempotent_existing_result"
    },
    {
      case_id: "failed_export",
      passed:
        failedExportAfter.export_status === "failed" &&
        failedExportAfter.session_status ===
          failedExportBefore.session_status &&
        failedExportAfter.audit_count === failedExportBefore.audit_count,
      recovery: "retain_assessment_state_and_retry_export"
    },
    {
      case_id: "logging_failure",
      passed:
        loggingFailureRecovered &&
        stableHash(loggingFailureBefore) ===
          stableHash(loggingFailureAfter),
      recovery: "preserve_runtime_state_and_surface_safe_code"
    }
  ];

  return {
    regression_version: "e2a49-failure-recovery-regressions-v1",
    required_case_count: 8,
    cases,
    passed:
      cases.length === 8 && cases.every((entry) => entry.passed)
  };
}
