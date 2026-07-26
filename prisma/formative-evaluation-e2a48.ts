import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  E2A48_ARTIFACT_NAMES,
  E2A48_ARTIFACT_ROOT,
  inspectE2A48AuditRun,
  latestE2A48AuditRunDirectory,
  makeE2A48AuditRunId,
  writeE2A48AuditArtifacts
} from "../src/lib/evaluation/formative/e2a48-production-deployment-readiness-protocol";

let networkRequestCount = 0;
globalThis.fetch = async () => {
  networkRequestCount += 1;
  throw new Error("e2a48_network_request_prohibited");
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function execute(runDirectory: string) {
  const before = networkRequestCount;
  const result = writeE2A48AuditArtifacts({
    runDirectory,
    networkRequestCount: networkRequestCount - before
  });
  assert(
    networkRequestCount === before,
    "e2a48_provider_call_guard_detected_network_request"
  );
  return result;
}

function artifactsAreReadOnly(runDirectory: string) {
  return readdirSync(runDirectory).every(
    (name) => (statSync(path.join(runDirectory, name)).mode & 0o777) === 0o444
  );
}

function runSmoke(suite: string) {
  const runDirectory = mkdtempSync(
    path.join(tmpdir(), "e2a48-deployment-audit-")
  );
  try {
    rmSync(runDirectory, { recursive: true, force: true });
    const result = execute(runDirectory);
    const audits = result.audits;
    const checks: Record<string, boolean> = {
      all:
        result.summary.passed &&
        result.artifactValidation.passed &&
        result.regressions.passed,
      environment:
        audits.environment.audit.audit_version ===
          "deployment-environment-audit-v1" &&
        audits.environment.audit.checks.length >= 7 &&
        audits.environment.safe_findings.raw_values_suppressed,
      database:
        audits.database.audit.audit_version ===
          "production-database-readiness-v1" &&
        audits.database.safe_findings.migration_count > 0 &&
        !audits.database.safe_findings.seed_is_automatic &&
        !audits.database.safe_findings.production_database_contacted,
      build:
        audits.build.audit.audit_version ===
          "deployment-build-readiness-v1" &&
        audits.build.safe_findings.node_major === 22 &&
        audits.build.safe_findings.render_start_command === "npm run start",
      runtime:
        audits.runtime.audit.audit_version ===
          "production-runtime-integrity-v1" &&
        result.protectedIntegrity.passed &&
        result.candidateIntegrity.passed,
      security:
        audits.security.audit.audit_version ===
          "deployment-security-readiness-v1" &&
        audits.security.safe_findings.raw_values_suppressed &&
        !audits.security.safe_findings.student_private_data_logged_by_audit &&
        !audits.security.safe_findings.hidden_prompts_logged_by_audit &&
        !audits.security.safe_findings.chain_of_thought_logged_by_audit,
      observability:
        audits.observability.audit.audit_version ===
          "deployment-observability-readiness-v1" &&
        audits.observability.safe_findings.health_endpoint === "/api/health" &&
        audits.observability.safe_findings.agent_call_failure_fields.includes(
          "client_request_id"
        ),
      render:
        audits.render.audit.audit_version ===
          "render-deployment-readiness-v1" &&
        audits.render.safe_findings.database_attachment ===
          "fromDatabase.connectionString" &&
        !audits.render.safe_findings.actual_render_service_contacted,
      "data-protection":
        result.dataProtection.passed &&
        result.dataProtection.student_data_boundary_preserved &&
        result.dataProtection.teacher_research_separation_preserved &&
        result.dataProtection.hidden_reasoning_not_teacher_visible &&
        result.dataProtection.hidden_reasoning_not_student_visible,
      regressions:
        result.regressions.passed &&
        result.regressions.required_case_count === 12 &&
        result.regressions.cases.length === 12,
      historical: result.historicalIntegrity.passed,
      "protected-components":
        result.protectedIntegrity.passed &&
        result.protectedIntegrity.evaluator_v5_unchanged &&
        result.protectedIntegrity.tutor_candidate_unchanged &&
        result.protectedIntegrity.e2a44_data_architecture_unchanged &&
        result.protectedIntegrity.e2a45_teacher_workflow_unchanged,
      budget:
        result.budget.provider_call_budget === 0 &&
        result.budget.network_request_budget === 0 &&
        result.budget.production_database_query_budget === 0 &&
        result.budget.deployment_budget === 0 &&
        !result.budget.deployment_executed &&
        !result.budget.candidate_approved &&
        !result.budget.candidate_activated,
      artifact:
        result.artifactValidation.passed &&
        readdirSync(runDirectory).length === E2A48_ARTIFACT_NAMES.length &&
        artifactsAreReadOnly(runDirectory),
      "provider-call-guard":
        result.providerCallGuard.passed &&
        result.providerCallGuard.provider_calls_made === 0 &&
        result.providerCallGuard.network_requests_made === 0 &&
        !result.providerCallGuard.provider_credentials_read &&
        networkRequestCount === 0
    };
    assert(suite in checks, `e2a48_unknown_smoke_suite:${suite}`);
    assert(checks[suite], `e2a48_${suite}_smoke_failed`);
    console.log(
      JSON.stringify(
        {
          status: "passed",
          suite,
          protocol_version: result.protocol.protocol_version,
          protocol_hash: result.protocol.protocol_hash,
          composite_runtime_identity_hash:
            result.compositeRuntimeIdentity.composite_runtime_identity_hash,
          contract_count: result.summary.contract_count,
          required_regression_count:
            result.summary.required_regression_count,
          deployment_readiness_status:
            result.summary.deployment_readiness_status,
          blocking_issue_count: result.summary.blocking_issue_count,
          manual_evidence_count: result.summary.manual_evidence_count,
          deployment_executed: false,
          classroom_pilot_executed: false,
          candidate_approved: false,
          candidate_activated: false,
          provider_calls_made: 0,
          network_requests_made: networkRequestCount
        },
        null,
        2
      )
    );
  } finally {
    if (readdirSync(runDirectory).length > 0) {
      chmodSync(runDirectory, 0o755);
      for (const name of readdirSync(runDirectory)) {
        chmodSync(path.join(runDirectory, name), 0o644);
      }
    }
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2] ?? "report";
  if (command === "run") {
    const runDirectory = path.join(
      E2A48_ARTIFACT_ROOT,
      makeE2A48AuditRunId()
    );
    const result = execute(runDirectory);
    console.log(
      JSON.stringify(
        {
          ...result.summary,
          artifact_directory: path.relative(process.cwd(), runDirectory),
          blocking_issue_codes:
            result.deploymentDecision.blocking_issue_codes,
          manual_evidence_codes:
            result.deploymentDecision.manual_evidence_codes
        },
        null,
        2
      )
    );
    return;
  }
  if (command === "report") {
    const runIndex = process.argv.indexOf("--run");
    const runDirectory =
      runIndex >= 0
        ? path.join(
            E2A48_ARTIFACT_ROOT,
            process.argv[runIndex + 1] ??
              "missing_e2a48_run_identifier"
          )
        : latestE2A48AuditRunDirectory();
    console.log(
      JSON.stringify(inspectE2A48AuditRun(runDirectory), null, 2)
    );
    return;
  }
  if (command === "smoke") {
    const suiteIndex = process.argv.indexOf("--suite");
    runSmoke(
      suiteIndex >= 0
        ? process.argv[suiteIndex + 1] ?? "all"
        : "all"
    );
    return;
  }
  throw new Error(`e2a48_unknown_command:${command}`);
}

main();
