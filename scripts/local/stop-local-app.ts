import {
  NEXT_DEV_LOG_PATH,
  NEXT_DEV_PID_PATH,
  ensureRuntimeDir,
  runCommand,
  stopNextDevServer
} from "./local-runtime";

async function main() {
  await ensureRuntimeDir();
  const stopPostgres = process.argv.includes("--postgres");
  const result = await stopNextDevServer();

  if (result.stopped) {
    console.log(`Stopped Next.js dev server with PID ${result.pid}.`);
  } else if (result.reason === "stale_pid_removed") {
    console.log(`Removed stale Next.js PID file for PID ${result.pid}.`);
  } else if (result.reason === "pid_file_missing_or_invalid") {
    console.log("No launcher-managed Next.js dev server PID was found.");
  } else {
    console.log(`Next.js dev server was not stopped: ${result.reason}.`);
  }

  if (stopPostgres) {
    const postgres = runCommand("docker", ["compose", "stop", "postgres"], 60_000);
    if (postgres.status === 0) {
      console.log("Stopped PostgreSQL container.");
    } else {
      console.log("Could not stop PostgreSQL container.");
      console.log(postgres.stderr || postgres.stdout || "No diagnostic output was returned.");
      process.exitCode = 1;
    }
  } else {
    console.log("PostgreSQL was left running. Pass `-- --postgres` to stop it too.");
  }

  console.log(`Logs: ${NEXT_DEV_LOG_PATH}`);
  console.log(`PID file: ${NEXT_DEV_PID_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

