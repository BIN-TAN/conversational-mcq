export const EVALUATION_DATABASE_LIFECYCLE_OWNER =
  "evaluation_entrypoint" as const;
export const EVALUATION_DATABASE_LIFECYCLE_VERSION =
  "evaluation-database-lifecycle-v2" as const;

export type EvaluationDatabaseLifecycleEvent =
  | "run_started"
  | "run_settled"
  | "disconnect_started"
  | "disconnect_completed";

export async function runWithEvaluationDatabaseLifecycle<T>(input: {
  run: () => Promise<T>;
  disconnect: () => Promise<void>;
  owner?: typeof EVALUATION_DATABASE_LIFECYCLE_OWNER;
  on_lifecycle_event?: (
    event: EvaluationDatabaseLifecycleEvent
  ) => void;
}) {
  if (
    input.owner !== undefined &&
    input.owner !== EVALUATION_DATABASE_LIFECYCLE_OWNER
  ) {
    throw new Error("evaluation_database_lifecycle_owner_invalid");
  }
  let runFailure: unknown = null;
  let disconnectStarted = false;
  try {
    input.on_lifecycle_event?.("run_started");
    const result = await input.run();
    input.on_lifecycle_event?.("run_settled");
    return result;
  } catch (error) {
    runFailure = error;
    input.on_lifecycle_event?.("run_settled");
    throw error;
  } finally {
    try {
      if (disconnectStarted) {
        throw new Error("evaluation_database_disconnect_duplicate");
      }
      disconnectStarted = true;
      input.on_lifecycle_event?.("disconnect_started");
      await input.disconnect();
      input.on_lifecycle_event?.("disconnect_completed");
    } catch (disconnectError) {
      if (runFailure === null) {
        throw disconnectError;
      }
    }
  }
}
