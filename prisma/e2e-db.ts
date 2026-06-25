import {
  assertE2eDatabaseUrl,
  backupE2eDatabaseIfPresent,
  createE2eDatabaseIfMissing,
  databaseExists,
  databaseName,
  defaultDatabaseUrl,
  dropE2eDatabaseIfPresent,
  e2eDatabaseUrl,
  migrateDeploy,
  redactedDatabaseUrl,
  runCommand
} from "./e2e-shared";

function assertGitPreflight() {
  runCommand("git", ["rev-parse", "--is-inside-work-tree"]);
  const commit = runCommand("git", ["cat-file", "-t", "42a2a73"]).stdout.trim();
  if (commit !== "commit") {
    throw new Error("Required Phase 8A baseline commit 42a2a73 was not found.");
  }

  for (const file of [".env", ".env.local", ".data", ".next"]) {
    const ignored = runCommand("git", ["check-ignore", "-q", file]);
    void ignored;
  }

  const trackedEnvExample = runCommand("git", ["ls-files", ".env.example"]).stdout.trim();
  if (trackedEnvExample !== ".env.example") {
    throw new Error(".env.example is not tracked.");
  }

  if (runCommand("git", ["remote", "-v"]).stdout.trim()) {
    throw new Error("Git remote is configured; Phase 8B must remain local.");
  }
}

async function preflight() {
  assertE2eDatabaseUrl(e2eDatabaseUrl());
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
        e2e_database_exists: exists,
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
  assertE2eDatabaseUrl(e2eDatabaseUrl());
  const backupPath = await backupE2eDatabaseIfPresent("pre-prepare");
  const created = await createE2eDatabaseIfMissing();
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
  assertE2eDatabaseUrl(e2eDatabaseUrl());
  const backupPath = await backupE2eDatabaseIfPresent("pre-reset");
  const dropped = await dropE2eDatabaseIfPresent();
  const created = await createE2eDatabaseIfMissing();
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
  assertE2eDatabaseUrl(e2eDatabaseUrl());
  const backupPath = await backupE2eDatabaseIfPresent("pre-cleanup");
  const dropped = await dropE2eDatabaseIfPresent();
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
    throw new Error(`Unknown E2E DB command: ${command}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
