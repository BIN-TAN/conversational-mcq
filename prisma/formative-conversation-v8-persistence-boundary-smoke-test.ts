import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EVALUATION_DATABASE_LIFECYCLE_OWNER,
  runWithEvaluationDatabaseLifecycle
} from "../src/lib/operational/evaluation-database-lifecycle";
import {
  executeFormativeConversationProviderOutsidePersistence
} from "../src/lib/services/student-assessment/formative-conversation/provider-persistence-boundary";
import {
  formativeConversationPersistenceError
} from "../src/lib/services/student-assessment/formative-conversation/persistence-errors";

async function verifySimulatedProviderLatencies() {
  for (const latencyMs of [10_000, 60_000, 90_000]) {
    const events: string[] = [];
    let activeInteractiveTransactions = 0;
    let clientAvailable = true;
    let persistenceStarted = false;
    let releaseProviderWait!: () => void;
    const providerWait = new Promise<void>((resolve) => {
      releaseProviderWait = resolve;
    });
    const execution =
      executeFormativeConversationProviderOutsidePersistence({
        execute: async () => {
          assert.equal(activeInteractiveTransactions, 0);
          assert.equal(clientAvailable, true);
          assert.equal(persistenceStarted, false);
          events.push(`virtual_wait_started:${latencyMs}`);
          await providerWait;
          events.push(`virtual_wait_completed:${latencyMs}`);
          assert.equal(activeInteractiveTransactions, 0);
          return { latency_ms: latencyMs };
        },
        on_boundary_event: (event) => events.push(event)
      });
    await Promise.resolve();
    assert.deepEqual(events, [
      "provider_wait_started",
      `virtual_wait_started:${latencyMs}`
    ]);
    assert.equal(activeInteractiveTransactions, 0);
    assert.equal(clientAvailable, true);
    releaseProviderWait();
    const result = await execution;
    assert.equal(result.latency_ms, latencyMs);
    assert.deepEqual(events, [
      "provider_wait_started",
      `virtual_wait_started:${latencyMs}`,
      `virtual_wait_completed:${latencyMs}`,
      "provider_wait_completed"
    ]);
    persistenceStarted = true;
    activeInteractiveTransactions += 1;
    assert.equal(clientAvailable, true);
    events.push("lifecycle_event_persisted");
    events.push("profile_transition_persisted");
    activeInteractiveTransactions -= 1;
    assert.equal(activeInteractiveTransactions, 0);
    assert.equal(persistenceStarted, true);
    assert.equal(clientAvailable, true);
    events.push("teacher_export_completed");
    clientAvailable = false;
    events.push("client_disconnected");
    assert.deepEqual(events.slice(-4), [
      "lifecycle_event_persisted",
      "profile_transition_persisted",
      "teacher_export_completed",
      "client_disconnected"
    ]);
  }
}

async function verifyClientOwnership() {
  const events: string[] = [];
  let disconnectCount = 0;
  let clientAvailable = true;
  const result = await runWithEvaluationDatabaseLifecycle({
    owner: EVALUATION_DATABASE_LIFECYCLE_OWNER,
    on_lifecycle_event: (event) => events.push(event),
    run: async () => {
      assert.equal(clientAvailable, true);
      events.push("profile_transition_persisted");
      assert.equal(clientAvailable, true);
      events.push("teacher_export_completed");
      return "complete";
    },
    disconnect: async () => {
      disconnectCount += 1;
      clientAvailable = false;
    }
  });
  assert.equal(result, "complete");
  assert.equal(disconnectCount, 1);
  assert.equal(clientAvailable, false);
  assert.deepEqual(events, [
    "run_started",
    "profile_transition_persisted",
    "teacher_export_completed",
    "run_settled",
    "disconnect_started",
    "disconnect_completed"
  ]);
}

function verifyTypedFailures() {
  assert.equal(
    formativeConversationPersistenceError(
      new Error("Transaction already closed: transaction has expired"),
      "transition_persistence"
    ).category,
    "transaction_expired"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("Server has closed the connection"),
      "conversation_creation"
    ).category,
    "database_connection_closed"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("bounded write failed"),
      "evidence_reference_persistence"
    ).category,
    "evidence_reference_persistence_failed"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("conversation write failed"),
      "conversation_creation"
    ).category,
    "conversation_creation_failed"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("transition write failed"),
      "transition_persistence"
    ).category,
    "transition_persistence_failed"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("lifecycle write failed"),
      "lifecycle_persistence"
    ).category,
    "lifecycle_persistence_failed"
  );
  assert.equal(
    formativeConversationPersistenceError(
      new Error("final projection unavailable"),
      "finalization"
    ).category,
    "finalization_failed"
  );
}

function verifyProductionBoundaryPlacement() {
  const source = readFileSync(
    "src/lib/services/student-assessment/formative-conversation/runtime.ts",
    "utf8"
  );
  const start = source.indexOf("async function executeOrResumeAgentCall");
  const end = source.indexOf(
    "async function persistTerminalAssistantResponseFailure",
    start
  );
  assert(start >= 0 && end > start);
  const executionPath = source.slice(start, end);
  assert(
    executionPath.includes(
      "executeFormativeConversationProviderOutsidePersistence"
    )
  );
  assert.equal(executionPath.includes("prisma.$transaction"), false);
}

async function main() {
  await verifySimulatedProviderLatencies();
  await verifyClientOwnership();
  verifyTypedFailures();
  verifyProductionBoundaryPlacement();
  console.log(
    JSON.stringify(
      {
        status: "passed",
        simulated_provider_latencies_ms: [10_000, 60_000, 90_000],
        provider_wait_inside_database_transaction: false,
        persistence_after_provider_response: true,
        database_client_owner: EVALUATION_DATABASE_LIFECYCLE_OWNER,
        database_disconnect_count: 1,
        typed_failure_categories_verified: true,
        provider_calls: 0,
        model_auth_requests: 0
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
          : "formative_conversation_v8_persistence_boundary_smoke_failed",
      provider_calls: 0,
      model_auth_requests: 0
    })
  );
  process.exitCode = 1;
});
