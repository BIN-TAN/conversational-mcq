export async function runWithEvaluationDatabaseLifecycle<T>(input: {
  run: () => Promise<T>;
  disconnect: () => Promise<void>;
}) {
  let runFailure: unknown = null;
  try {
    return await input.run();
  } catch (error) {
    runFailure = error;
    throw error;
  } finally {
    try {
      await input.disconnect();
    } catch (disconnectError) {
      if (runFailure === null) {
        throw disconnectError;
      }
    }
  }
}
