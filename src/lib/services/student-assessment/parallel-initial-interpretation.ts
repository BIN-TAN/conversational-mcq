// Freeze integration evidence before starting the other provider, then join before
// publishing profiles or opening a conversation. Drain both branches on failure.
export async function runParallelInitialInterpretation(input: {
  integration: (sourceReady: () => void) => Promise<unknown>;
  activity: (beforePersistence: () => Promise<void>) => Promise<unknown>;
}) {
  let sourceReady!: () => void;
  let sourceFailed!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { sourceReady = resolve; sourceFailed = reject; });
  const integration = Promise.resolve().then(() => input.integration(sourceReady));
  void integration.then(sourceReady, sourceFailed);
  const activity = (async () => {
    await ready;
    return input.activity(async () => { await integration; });
  })();
  const results = await Promise.allSettled([integration, activity]);
  for (const result of results) if (result.status === "rejected") throw result.reason;
}
