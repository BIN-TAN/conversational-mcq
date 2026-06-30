import {
  LOCAL_APP_URL,
  NEXT_DEV_LOG_PATH,
  NEXT_DEV_PID_PATH,
  checkRequiredTools,
  ensureRuntimeDir,
  getNextDevPidStatus,
  isHttpReady,
  openBrowser,
  removePidFile,
  runLlmReadiness,
  safeFailureMessage,
  startNextDevServer,
  startPostgres,
  waitForHttpReady
} from "./local-runtime";

async function main() {
  await ensureRuntimeDir();

  const tools = checkRequiredTools();
  if (!tools.allAvailable) {
    console.error("Local launcher cannot start because required tools are missing.");
    console.error(JSON.stringify(tools, null, 2));
    process.exit(1);
  }

  console.log("Starting local PostgreSQL container...");
  const postgres = startPostgres();
  if (postgres.status !== 0) {
    console.error("Failed to start PostgreSQL with `docker compose up -d postgres`.");
    console.error(postgres.stderr || postgres.stdout || "No diagnostic output was returned.");
    process.exit(1);
  }

  console.log("Checking authenticated server-side LLM readiness...");
  const readiness = runLlmReadiness();
  if (!readiness.ok) {
    console.error(safeFailureMessage(readiness));
    process.exit(1);
  }

  const existing = await getNextDevPidStatus();
  if (existing.pid && !existing.running) {
    await removePidFile();
  }

  if (existing.running && await isHttpReady()) {
    console.log(`Next.js dev server is already running with PID ${existing.pid}.`);
    const opened = openBrowser();
    if (opened.status !== 0) {
      console.log(`Open your browser to ${LOCAL_APP_URL}`);
    }
    console.log("Conversational MCQ is ready.");
    console.log(`Logs: ${NEXT_DEV_LOG_PATH}`);
    console.log(`PID file: ${NEXT_DEV_PID_PATH}`);
    return;
  }

  if (!existing.running && await isHttpReady()) {
    console.log("A local server is already responding on http://localhost:3000.");
    const opened = openBrowser();
    if (opened.status !== 0) {
      console.log(`Open your browser to ${LOCAL_APP_URL}`);
    }
    console.log("Conversational MCQ appears ready.");
    console.log(`Logs for launcher-managed starts: ${NEXT_DEV_LOG_PATH}`);
    return;
  }

  console.log("Starting Next.js dev server in the background...");
  const pid = await startNextDevServer();
  const ready = await waitForHttpReady();
  if (!ready) {
    console.error("Next.js dev server did not respond within the startup timeout.");
    console.error(`Check logs at ${NEXT_DEV_LOG_PATH}`);
    console.error("Run `npm run app:local:status` for current status.");
    process.exit(1);
  }

  const opened = openBrowser();
  if (opened.status !== 0) {
    console.log(`Open your browser to ${LOCAL_APP_URL}`);
  }

  console.log("Conversational MCQ local app is ready.");
  console.log(`URL: ${LOCAL_APP_URL}`);
  console.log(`Next.js PID: ${pid}`);
  console.log(`Logs: ${NEXT_DEV_LOG_PATH}`);
  console.log(`PID file: ${NEXT_DEV_PID_PATH}`);
  console.log("Stop with `npm run app:local:stop`.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

