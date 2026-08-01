import assert from "node:assert/strict";
import {
  createEvaluationDatabaseConnectionOwner,
  EVALUATION_DATABASE_CONNECTION_OWNER_VERSION,
  EVALUATION_DATABASE_READ_RECOVERY_VERSION
} from "../src/lib/operational/evaluation-database-connection-owner";
import {
  executeFormativeConversationIdempotentWrite,
  executeFormativeConversationPersistenceRead,
  withFormativeConversationPersistenceDiagnostics,
  type FormativeConversationPersistenceDiagnostic
} from "../src/lib/services/student-assessment/formative-conversation/persistence-observability";
import { FormativeConversationPersistenceError } from "../src/lib/services/student-assessment/formative-conversation/persistence-errors";

function connectionClosed() {
  return new Error("Server has closed the connection.");
}

async function main() {
  let connectCount = 0;
  let disconnectCount = 0;
  const diagnostics: FormativeConversationPersistenceDiagnostic[] = [];
  const owner = createEvaluationDatabaseConnectionOwner({
    client: {
      async $connect() {
        connectCount += 1;
      },
      async $disconnect() {
        disconnectCount += 1;
      }
    },
    client_id: "v9-recovery-smoke-client",
    on_diagnostic: (diagnostic) => diagnostics.push(diagnostic)
  });
  const scope = {
    record: owner.record_diagnostic,
    connection_identity: owner.identity,
    run_read: owner.run_read,
    run_idempotent_write: owner.run_idempotent_write
  };

  await withFormativeConversationPersistenceDiagnostics(
    scope,
    async () => {
      let readAttempts = 0;
      const recoveredRead =
        await executeFormativeConversationPersistenceRead({
          operation_name: "recovered_context_read",
          logical_operation_id: "read:recovered",
          execute: async () => {
            readAttempts += 1;
            if (readAttempts === 1) {
              throw connectionClosed();
            }
            return "context-loaded";
          }
        });
      assert.equal(recoveredRead, "context-loaded");
      assert.equal(readAttempts, 2);
      assert.equal(owner.state().client_generation, 2);

      let nonConnectionAttempts = 0;
      await assert.rejects(
        () =>
          executeFormativeConversationPersistenceRead({
            operation_name: "non_connection_read",
            logical_operation_id: "read:not-retryable",
            execute: async () => {
              nonConnectionAttempts += 1;
              throw new Error("permission denied");
            }
          }),
        (error: unknown) =>
          error instanceof FormativeConversationPersistenceError &&
          error.category === "context_read_failed" &&
          error.retry_permitted === false
      );
      assert.equal(nonConnectionAttempts, 1);

      let exhaustedAttempts = 0;
      await assert.rejects(
        () =>
          executeFormativeConversationPersistenceRead({
            operation_name: "exhausted_context_read",
            logical_operation_id: "read:exhausted",
            execute: async () => {
              exhaustedAttempts += 1;
              throw connectionClosed();
            }
          }),
        (error: unknown) =>
          error instanceof FormativeConversationPersistenceError &&
          error.category === "context_read_retry_exhausted" &&
          error.attempt_number === 2 &&
          error.terminal_result === "retry_exhausted"
      );
      assert.equal(exhaustedAttempts, 2);

      let committed = false;
      let executeAfterCommitCount = 0;
      const reconciledWrite =
        await executeFormativeConversationIdempotentWrite({
          operation_name: "message_reservation_after_commit",
          logical_operation_id: "write:reconciled",
          execute: async () => {
            executeAfterCommitCount += 1;
            committed = true;
            throw connectionClosed();
          },
          reconcile: async () =>
            committed
              ? {
                  status: "committed" as const,
                  value: "existing-receipt"
                }
              : { status: "not_committed" as const }
        });
      assert.equal(reconciledWrite, "existing-receipt");
      assert.equal(executeAfterCommitCount, 1);

      let beforeCommitAttempts = 0;
      let committedWriteCount = 0;
      const retriedWrite =
        await executeFormativeConversationIdempotentWrite({
          operation_name: "message_reservation_before_commit",
          logical_operation_id: "write:retried",
          execute: async () => {
            beforeCommitAttempts += 1;
            if (beforeCommitAttempts === 1) {
              throw connectionClosed();
            }
            committedWriteCount += 1;
            return "new-receipt";
          },
          reconcile: async () => ({
            status: "not_committed" as const
          })
        });
      assert.equal(retriedWrite, "new-receipt");
      assert.equal(beforeCommitAttempts, 2);
      assert.equal(committedWriteCount, 1);
    }
  );

  assert(
    diagnostics.some(
      (entry) =>
        entry.logical_operation_id === "read:recovered" &&
        entry.terminal_result === "retrying"
    )
  );
  assert(
    diagnostics.some(
      (entry) =>
        entry.logical_operation_id === "write:reconciled" &&
        entry.phase === "post_transaction_reconciliation"
    )
  );
  assert(diagnostics.every((entry) => entry.client_id !== null));

  await owner.disconnect_final();
  assert.equal(owner.state().final_disconnect_completed, true);
  await assert.rejects(
    () => owner.disconnect_final(),
    /evaluation_database_final_disconnect_duplicate/
  );
  assert.equal(connectCount, 4);
  assert.equal(disconnectCount, 5);

  console.log(
    JSON.stringify({
      status: "passed",
      owner_version: EVALUATION_DATABASE_CONNECTION_OWNER_VERSION,
      recovery_version: EVALUATION_DATABASE_READ_RECOVERY_VERSION,
      diagnostics_recorded: diagnostics.length,
      bounded_read_retry: true,
      idempotent_write_reconciliation: true,
      duplicate_final_disconnect_blocked: true,
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      status: "failed",
      error_code:
        error instanceof Error
          ? error.message
          : "formative_conversation_v9_database_recovery_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
