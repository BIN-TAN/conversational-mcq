import { prisma } from "../src/lib/db";
import { runInitialPreparationWorker } from "../src/lib/workflow/initial-preparation";
import { getServerEnv } from "../src/lib/env";

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

// Bounded parallelism lets another student's job start without draining the legacy queue.
Promise.all(Array.from({ length: getServerEnv().INITIAL_PREPARATION_CONCURRENCY }, () => runInitialPreparationWorker(shutdown.signal)))
  .catch(() => { console.error("Initial preparation worker stopped unexpectedly."); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
