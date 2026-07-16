import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { LIFECYCLE_OPERATION_RESULT_VERSION } from "../src/lib/services/student-assessment/lifecycle-operations";
import {
  resolveApplicationBuildInfo,
  summarizeApplicationBuildInfoResolution
} from "../src/lib/provenance/application-build-info";

function packageVersion() {
  const packageJson = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
    version?: string;
  };
  return packageJson.version ?? "unknown";
}

function latestMigrationVersion() {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  return readdirSync(migrationsDir)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .at(-1) ?? "none";
}

function prismaSchemaHash() {
  const schema = readFileSync(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  return createHash("sha256").update(schema).digest("hex").slice(0, 16);
}

console.log(
  JSON.stringify(
    {
      application_name: "conversational-mcq",
      application_version: packageVersion(),
      ...summarizeApplicationBuildInfoResolution(resolveApplicationBuildInfo()),
      prisma_latest_migration: latestMigrationVersion(),
      prisma_schema_hash_prefix: prismaSchemaHash(),
      lifecycle_contract_version: LIFECYCLE_OPERATION_RESULT_VERSION
    },
    null,
    2
  )
);
