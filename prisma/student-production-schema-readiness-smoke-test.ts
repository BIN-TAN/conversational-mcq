import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function source(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

async function currentSchemaState() {
  const [userColumns, securityTables] = await Promise.all([
    prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name IN ('email_normalized', 'email_verified_at', 'pending_email', 'pending_email_normalized', 'email_change_requested_at')
    `,
    prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('account_security_tokens', 'account_security_rate_limits', 'account_security_events')
    `
  ]);

  return {
    userColumns: new Set(userColumns.map((column) => column.column_name)),
    securityTables: new Set(securityTables.map((table) => table.table_name))
  };
}

function assertAuthQueryIsSchemaTolerant(relativePath: string) {
  const file = source(relativePath);
  assert(file.includes("select:"), `${relativePath} must use explicit Prisma select projections.`);
  assert(file.includes("user_id: true"), `${relativePath} must select user_id.`);
  assert(file.includes("auth_version: true"), `${relativePath} must select auth_version.`);
  assert(!file.includes("email_normalized: true"), `${relativePath} must not require email_normalized for login/session.`);
  assert(!file.includes("email_verified_at: true"), `${relativePath} must not require email_verified_at for login/session.`);
  assert(!file.includes("pending_email: true"), `${relativePath} must not require pending_email for login/session.`);
  assert(!file.includes("pending_email_normalized: true"), `${relativePath} must not require pending_email_normalized for login/session.`);
}

async function main() {
  const requiredUserColumns = [
    "email_normalized",
    "email_verified_at",
    "pending_email",
    "pending_email_normalized",
    "email_change_requested_at"
  ];
  const requiredTables = [
    "account_security_tokens",
    "account_security_rate_limits",
    "account_security_events"
  ];
  const schema = await currentSchemaState();

  for (const column of requiredUserColumns) {
    assert(schema.userColumns.has(column), `Current database is missing users.${column}; run npm run prisma:migrate:deploy.`);
  }
  for (const table of requiredTables) {
    assert(schema.securityTables.has(table), `Current database is missing ${table}; run npm run prisma:migrate:deploy.`);
  }

  const healthRoute = source("src/app/api/health/route.ts");
  assert(healthRoute.includes("database_schema_ready"), "Health route must report schema readiness.");
  assert(healthRoute.includes("migration_required"), "Health route must report migration_required when schema checks fail.");
  assert(healthRoute.includes("information_schema.columns"), "Health route must verify required columns safely.");
  assert(healthRoute.includes("information_schema.tables"), "Health route must verify required tables safely.");
  assert(!healthRoute.includes("DATABASE_URL"), "Health route must not print database URLs.");

  assertAuthQueryIsSchemaTolerant("src/app/api/auth/login/route.ts");
  assertAuthQueryIsSchemaTolerant("src/lib/auth.ts");

  const renderYaml = source("render.yaml");
  const packageJson = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert(
    renderYaml.includes("preDeployCommand: npm run prisma:migrate:deploy"),
    "Render Blueprint must run migrations before serving traffic."
  );
  assert(
    packageJson.scripts["prisma:migrate:deploy"] === "prisma migrate deploy",
    "package.json must expose prisma:migrate:deploy."
  );

  console.log(
    JSON.stringify(
      {
        status: "passed",
        required_user_columns_present: requiredUserColumns,
        required_account_security_tables_present: requiredTables,
        health_schema_readiness_check_declared: true,
        login_query_does_not_depend_on_email_columns: true,
        session_query_does_not_depend_on_email_columns: true,
        render_predeploy_migrations_declared: true,
        no_openai_call_occurred: true
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          error: error instanceof Error ? error.message : "unknown_error",
          no_openai_call_occurred: true
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
