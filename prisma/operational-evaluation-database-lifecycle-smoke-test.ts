import assert from "node:assert/strict";
import {
  EVALUATION_DATABASE_LIFECYCLE_OWNER,
  EVALUATION_DATABASE_LIFECYCLE_VERSION,
  runWithEvaluationDatabaseLifecycle
} from "../src/lib/operational/evaluation-database-lifecycle";

async function successfulLifecycle() {
  const order: string[] = [];
  const result = await runWithEvaluationDatabaseLifecycle({
    owner: EVALUATION_DATABASE_LIFECYCLE_OWNER,
    on_lifecycle_event: (event) => order.push(event),
    run: async () => {
      order.push("case_1");
      order.push("case_2");
      order.push("case_3");
      order.push("research_export_complete");
      order.push("artifact_manifest_complete");
      order.push("database_audit_complete");
      return {
        cases: 3,
        export_rows: 12,
        artifact_count: 8,
        database_writes: 9
      };
    },
    disconnect: async () => {
      order.push("prisma_disconnect");
    }
  });

  assert.deepEqual(order, [
    "run_started",
    "case_1",
    "case_2",
    "case_3",
    "research_export_complete",
    "artifact_manifest_complete",
    "database_audit_complete",
    "run_settled",
    "disconnect_started",
    "prisma_disconnect",
    "disconnect_completed"
  ]);
  assert.deepEqual(result, {
    cases: 3,
    export_rows: 12,
    artifact_count: 8,
    database_writes: 9
  });
}

async function failedLifecycle() {
  const order: string[] = [];
  await assert.rejects(
    runWithEvaluationDatabaseLifecycle({
      run: async () => {
        order.push("case_1");
        order.push("typed_failure_recorded");
        throw new Error("deterministic_case_failure");
      },
      disconnect: async () => {
        order.push("prisma_disconnect");
      }
    }),
    /deterministic_case_failure/
  );
  assert.deepEqual(order, [
    "case_1",
    "typed_failure_recorded",
    "prisma_disconnect"
  ]);
}

async function disconnectFailure() {
  await assert.rejects(
    runWithEvaluationDatabaseLifecycle({
      run: async () => "complete",
      disconnect: async () => {
        throw new Error("deterministic_disconnect_failure");
      }
    }),
    /deterministic_disconnect_failure/
  );

  await assert.rejects(
    runWithEvaluationDatabaseLifecycle({
      run: async () => {
        throw new Error("primary_evaluation_failure");
      },
      disconnect: async () => {
        throw new Error("secondary_disconnect_failure");
      }
    }),
    /primary_evaluation_failure/
  );
}

async function main() {
  await successfulLifecycle();
  await failedLifecycle();
  await disconnectFailure();
  await assert.rejects(
    runWithEvaluationDatabaseLifecycle({
      owner: "nested_service" as typeof EVALUATION_DATABASE_LIFECYCLE_OWNER,
      run: async () => "not_reached",
      disconnect: async () => undefined
    }),
    /evaluation_database_lifecycle_owner_invalid/
  );
  console.log(
    JSON.stringify(
      {
        status: "passed",
        provider_calls: 0,
        network_requests: 0,
        cases_before_disconnect: 3,
        export_before_disconnect: true,
        artifacts_before_disconnect: true,
        database_audit_before_disconnect: true,
        cleanup_on_failure: true,
        connection_close_noise: 0,
        database_lifecycle_version:
          EVALUATION_DATABASE_LIFECYCLE_VERSION,
        database_client_owner: EVALUATION_DATABASE_LIFECYCLE_OWNER,
        nested_service_ownership_rejected: true
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "operational_evaluation_database_lifecycle_smoke_failed",
      provider_calls: 0,
      network_requests: 0
    })
  );
  process.exitCode = 1;
});
