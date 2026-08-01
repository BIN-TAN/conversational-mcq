import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { createEvaluationDatabaseConnectionOwner } from "../src/lib/operational/evaluation-database-connection-owner";
import { scanExactSecretArtifactSet } from "../src/lib/operational/exact-secret-artifact-scanner";
import {
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
  FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
  executeFormativeConversationV9RemoteDatabaseCanary
} from "../src/lib/operational/formative-conversation-v5-evaluation-v9/remote-database-canary";
import { FORMATIVE_CONVERSATION_V9_DATABASE_CANARY_REQUIRED_ENVIRONMENT } from "../src/lib/operational/formative-conversation-v5-evaluation-v9/live-environment";
import {
  withFormativeConversationPersistenceDiagnostics,
  type FormativeConversationPersistenceDiagnostic
} from "../src/lib/services/student-assessment/formative-conversation/persistence-observability";
import { installFormativeConversationV5TestEnvironment } from "./helpers/formative-conversation-v5-v9-test-environment";

async function main() {
  const restoreEnvironment =
    installFormativeConversationV5TestEnvironment({
      FORMATIVE_CONVERSATION_V5_V9_REMOTE_DATABASE_CANARY_ENABLED:
        "true"
    });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY_FILE;
  process.env.FORMATIVE_CONVERSATION_V5_V9_CANARY_SESSION_SECRET_SOURCE =
    "ephemeral_canary";
  process.env.FORMATIVE_CONVERSATION_V5_V9_INJECTED_ENVIRONMENT_KEYS = [
    ...new Set([
      ...Object.entries(process.env)
        .filter(([, value]) => Boolean(value?.trim()))
        .map(([name]) => name),
      ...FORMATIVE_CONVERSATION_V9_DATABASE_CANARY_REQUIRED_ENVIRONMENT
    ])
  ]
    .sort()
    .join(",");
  const diagnostics: FormativeConversationPersistenceDiagnostic[] = [];
  const owner = createEvaluationDatabaseConnectionOwner({
    client: prisma,
    client_id: "v9-remote-database-canary-smoke-prisma",
    on_diagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  const waits: number[] = [];
  let artifactRoot: string | null = null;
  let failureArtifactRoot: string | null = null;
  try {
    const result =
      await withFormativeConversationPersistenceDiagnostics(
        {
          record: owner.record_diagnostic,
          connection_identity: owner.identity,
          run_read: owner.run_read,
          run_idempotent_write: owner.run_idempotent_write
        },
        () =>
          executeFormativeConversationV9RemoteDatabaseCanary({
            authorization:
              FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
            diagnostics,
            sleep: async (milliseconds) => {
              waits.push(milliseconds);
            }
          })
      );
    artifactRoot = result.artifact_root;
    assert.equal(result.status, "passed");
    assert.equal(
      result.contract_hash,
      FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH
    );
    assert.deepEqual(waits, [10_000, 60_000, 90_000]);
    assert.equal(result.cleanup_completed, true);
    assert.equal(result.provider_calls, 0);
    assert.equal(result.model_auth_requests, 0);
    assert.equal(result.dispatch_checkpoints, 0);
    const report = JSON.parse(
      await readFile(path.join(artifactRoot, "canary-report.json"), "utf8")
    ) as {
      status: string;
      waits: Array<{ requested_wait_ms: number }>;
      outcomes: Array<{ outcome: string }>;
      transaction_summary: {
        count: number;
        timeout_ms: number;
        open_during_simulated_wait: boolean;
      };
      isolated_record_counts: {
        formative_conversation_sessions: number;
        agent_calls: number;
        profile_transitions: number;
        duplicate_audit: Record<string, number>;
      };
      idempotency_replay: { status: string; record_counts_unchanged: boolean };
      artifact_secret_scan: { status: string; matches_found: number };
      cleanup: { status: string; retained_synthetic_database_records: number };
      research_export: { validation_status: string };
    };
    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.waits.map((entry) => entry.requested_wait_ms),
      waits
    );
    assert.deepEqual(
      report.outcomes.map((entry) => entry.outcome),
      [
        "sound",
        "largely_improved",
        "teacher_assistance_recommended"
      ]
    );
    assert(report.transaction_summary.count > 0);
    assert.equal(report.transaction_summary.timeout_ms, 30_000);
    assert.equal(report.transaction_summary.open_during_simulated_wait, false);
    assert.equal(report.isolated_record_counts.formative_conversation_sessions, 3);
    assert.equal(report.isolated_record_counts.agent_calls, 6);
    assert.equal(report.isolated_record_counts.profile_transitions, 3);
    assert.deepEqual(
      Object.values(report.isolated_record_counts.duplicate_audit),
      [0, 0, 0, 0, 0]
    );
    assert.equal(report.idempotency_replay.status, "passed");
    assert.equal(report.idempotency_replay.record_counts_unchanged, true);
    assert.equal(report.artifact_secret_scan.status, "passed");
    assert.equal(report.artifact_secret_scan.matches_found, 0);
    assert.equal(report.cleanup.status, "completed");
    assert.equal(report.cleanup.retained_synthetic_database_records, 0);
    assert.equal(report.research_export.validation_status, "passed");
    const exactSecrets = [
      process.env.DATABASE_URL,
      process.env.OPENAI_API_KEY,
      process.env.RESEARCH_PSEUDONYMIZATION_KEY,
      process.env.SESSION_SECRET
    ].filter((value): value is string => Boolean(value));
    const scan = await scanExactSecretArtifactSet({
      artifact_roots: [artifactRoot],
      exact_secret_values: exactSecrets
    });
    assert.equal(scan.status, "passed");
    assert.equal(scan.matches_found, 0);

    const canaryRoot = path.resolve(
      ".data/operational-formative-conversation-v5-evaluation-v9/remote-database-canaries"
    );
    const beforeFailure = new Set(await readdir(canaryRoot));
    await assert.rejects(
      () =>
        withFormativeConversationPersistenceDiagnostics(
          {
            record: owner.record_diagnostic,
            connection_identity: owner.identity,
            run_read: owner.run_read,
            run_idempotent_write: owner.run_idempotent_write
          },
          () =>
            executeFormativeConversationV9RemoteDatabaseCanary({
              authorization:
                FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_AUTHORIZATION,
              diagnostics,
              sleep: async () => {
                throw new Error(
                  "formative_conversation_v9_canary_injected_context_read_failure"
                );
              }
            })
        ),
      /formative_conversation_v9_remote_database_transition_validation_failed/u
    );
    const addedFailureRoots = (await readdir(canaryRoot)).filter(
      (entry) => !beforeFailure.has(entry)
    );
    assert.equal(addedFailureRoots.length, 1);
    failureArtifactRoot = path.join(canaryRoot, addedFailureRoots[0]);
    const failureReport = JSON.parse(
      await readFile(
        path.join(failureArtifactRoot, "canary-failure-report.json"),
        "utf8"
      )
    ) as {
      status: string;
      failure_code: string;
      protocol_execution: Array<{ execution_error: string | null }>;
      artifact_secret_scan: { status: string; matches_found: number };
      cleanup: { status: string; retained_synthetic_database_records: number };
    };
    assert.equal(failureReport.status, "failed");
    assert.equal(
      failureReport.failure_code,
      "formative_conversation_v9_remote_database_transition_validation_failed"
    );
    assert(
      failureReport.protocol_execution.some(
        (entry) =>
          entry.execution_error ===
          "formative_conversation_v9_canary_injected_context_read_failure"
      )
    );
    assert.equal(failureReport.artifact_secret_scan.status, "passed");
    assert.equal(failureReport.artifact_secret_scan.matches_found, 0);
    assert.equal(failureReport.cleanup.status, "completed");
    assert.equal(
      failureReport.cleanup.retained_synthetic_database_records,
      0
    );
  } finally {
    await owner.disconnect_final();
    if (artifactRoot) {
      await rm(artifactRoot, { recursive: true, force: true });
    }
    if (failureArtifactRoot) {
      await rm(failureArtifactRoot, { recursive: true, force: true });
    }
    restoreEnvironment();
  }

  console.log(
    JSON.stringify({
      status: "passed",
      canary_contract_hash:
        FORMATIVE_CONVERSATION_V9_REMOTE_DATABASE_CANARY_CONTRACT_HASH,
      simulated_wait_schedule_ms: waits,
      isolated_synthetic_cleanup: true,
      exact_secret_scan: "passed",
      provider_calls: 0,
      model_auth_requests: 0,
      dispatch_checkpoints: 0
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message.split(":", 1)[0]
          : "formative_conversation_v9_remote_database_canary_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
