import {
  assertLiveCanaryDatabaseUrl,
  backupLiveCanaryDatabaseIfPresent,
  createLiveCanaryDatabaseIfMissing,
  databaseExists,
  databaseName,
  defaultDatabaseUrl,
  dropLiveCanaryDatabaseIfPresent,
  liveCanaryDatabaseUrl,
  migrateDeploy,
  redactedDatabaseUrl,
  runCommand
} from "./operational-live-canary-shared";

function assertGitPreflight() {
  runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  const commit = runCommand("git", ["cat-file", "-t", "03a42b6"]).stdout.trim();
  if (commit !== "commit") {
    throw new Error("Required Phase 8B baseline commit 03a42b6 was not found.");
  }

  for (const file of [".env", ".env.local", ".data", ".next"]) {
    runCommand("git", ["check-ignore", "-q", file]);
  }

  const trackedEnvExample = runCommand("git", ["ls-files", ".env.example"]).stdout.trim();
  if (trackedEnvExample !== ".env.example") {
    throw new Error(".env.example is not tracked.");
  }

  if (runCommand("git", ["remote", "-v"]).stdout.trim()) {
    throw new Error("Git remote is configured; Phase 8C must remain local.");
  }
}

async function preflight() {
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());
  assertGitPreflight();
  runCommand("docker", ["compose", "ps", "postgres"]);

  const exists = await databaseExists();
  const gitStatus = runCommand("git", ["status", "--short"]).stdout
    .split("\n")
    .filter(Boolean);
  console.log(
    JSON.stringify(
      {
        status: "ok",
        database_name: databaseName(),
        database_url: redactedDatabaseUrl(),
        normal_database_url: redactedDatabaseUrl(defaultDatabaseUrl()),
        live_canary_database_exists: exists,
        tracked_worktree_clean: gitStatus.length === 0,
        tracked_worktree_changes: gitStatus,
        destructive_operations_guarded_by_suffix: true
      },
      null,
      2
    )
  );
}

async function prepare() {
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());
  const backupPath = await backupLiveCanaryDatabaseIfPresent("pre-prepare");
  const created = await createLiveCanaryDatabaseIfMissing();
  migrateDeploy();
  console.log(
    JSON.stringify(
      {
        status: "prepared",
        database_name: databaseName(),
        database_url: redactedDatabaseUrl(),
        created,
        backup_path: backupPath
      },
      null,
      2
    )
  );
}

async function reset() {
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());
  const backupPath = await backupLiveCanaryDatabaseIfPresent("pre-reset");
  const dropped = await dropLiveCanaryDatabaseIfPresent();
  const created = await createLiveCanaryDatabaseIfMissing();
  migrateDeploy();
  console.log(
    JSON.stringify(
      {
        status: "reset",
        database_name: databaseName(),
        database_url: redactedDatabaseUrl(),
        dropped,
        created,
        backup_path: backupPath
      },
      null,
      2
    )
  );
}

async function cleanup() {
  assertLiveCanaryDatabaseUrl(liveCanaryDatabaseUrl());
  const backupPath = await backupLiveCanaryDatabaseIfPresent("pre-cleanup");
  const dropped = await dropLiveCanaryDatabaseIfPresent();
  console.log(
    JSON.stringify(
      {
        status: "cleaned",
        database_name: databaseName(),
        dropped,
        backup_path: backupPath
      },
      null,
      2
    )
  );
}

async function main() {
  const command = process.argv[2] ?? "preflight";

  if (command === "preflight") {
    await preflight();
  } else if (command === "prepare") {
    await prepare();
  } else if (command === "reset") {
    await reset();
  } else if (command === "cleanup") {
    await cleanup();
  } else {
    throw new Error(`Unknown live canary DB command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
