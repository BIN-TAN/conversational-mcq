import {
  LOCAL_APP_URL,
  NEXT_DEV_LOG_PATH,
  NEXT_DEV_PID_PATH,
  checkRequiredTools,
  getNextDevPidStatus,
  getPostgresStatus,
  isHttpReady,
  runLlmReadiness,
  summarizeReadiness
} from "./local-runtime";

async function main() {
  const tools = checkRequiredTools();
  const postgres = getPostgresStatus();
  const nextDev = await getNextDevPidStatus();
  const httpResponding = await isHttpReady();
  const readiness = runLlmReadiness();

  const report = {
    status_version: "local-runtime-status-v1",
    tools,
    postgres,
    next_dev_server: {
      pid: nextDev.pid,
      running: nextDev.running,
      http_responding: httpResponding,
      url: LOCAL_APP_URL
    },
    files: {
      logs: NEXT_DEV_LOG_PATH,
      pid_file: NEXT_DEV_PID_PATH
    },
    llm_readiness: summarizeReadiness(readiness),
    next_command: httpResponding
      ? "npm run app:local:stop"
      : readiness.ok
        ? "npm run app:local:start"
        : "npm run llm:readiness"
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

